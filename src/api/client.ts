import { joinPath, parseBaseUrl } from "./base-url";
import { Breaker } from "./breaker";
import {
  decodeEntryResponse,
  decodeInfoData,
  decodePlatformsData,
  decodeRegionsData,
  decodeSearchData,
} from "./decode";
import { MothdexError } from "./errors";
import { type ClientOptions, type ResolvedOptions, resolveOptions } from "./options";
import { parseResponse } from "./parse";
import { TokenBucket } from "./rate-limit";
import { INITIAL_RETRY_STATE, planRetry } from "./retry";
import { exchange } from "./transport";
import type {
  DbInfo,
  Entry,
  Filters,
  Platform,
  Region,
  SearchRequest,
  SearchResponse,
} from "./types";
import { filtersBody, searchBody, validateFilters, validateSearch, validateSlug } from "./validate";

interface Call {
  readonly op: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: Record<string, unknown>;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Client for the Mothdex API v1. Same rules as the Go client in mothdex-cli: A6 envelope check
 * (HTTP status, then info.error), a 5 req/s token bucket, a 429 breach circuit, bounded
 * retries, https only. Safe for concurrent use inside one process.
 */
export class MothdexClient {
  readonly #opts: ResolvedOptions;
  readonly #bucket: TokenBucket;
  readonly #breaker: Breaker;

  constructor(options: ClientOptions = {}) {
    this.#opts = resolveOptions(options, parseBaseUrl);
    this.#bucket = new TokenBucket(this.#opts.rateLimit, this.#opts.burst, this.#opts.clock.now());
    this.#breaker = new Breaker(this.#opts.cooldownUntilMs);
  }

  /** POST /search */
  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    const op = "search";
    validateSearch(op, request);
    const data = await this.#call({
      op,
      method: "POST",
      path: "/search",
      body: searchBody(request),
      signal,
    });
    return decodeSearchData(data);
  }

  /** POST /entry. An unknown slug throws a "not_found" error. */
  async entry(slug: string, signal?: AbortSignal): Promise<Entry> {
    const op = "entry";
    validateSlug(op, slug);
    const data = await this.#call({ op, method: "POST", path: "/entry", body: { slug }, signal });
    return decodeEntryResponse(op)(data);
  }

  /** POST /entry/random (POST only). */
  async random(filters: Filters = {}, signal?: AbortSignal): Promise<Entry> {
    const op = "random";
    validateFilters(op, filters);
    const data = await this.#call({
      op,
      method: "POST",
      path: "/entry/random",
      body: filtersBody(filters),
      signal,
    });
    return decodeEntryResponse(op)(data);
  }

  /** GET /platforms, sorted by id. */
  async platforms(signal?: AbortSignal): Promise<Platform[]> {
    const data = await this.#call({ op: "platforms", method: "GET", path: "/platforms", signal });
    return decodePlatformsData(data);
  }

  /** GET /regions, sorted by id. */
  async regions(signal?: AbortSignal): Promise<Region[]> {
    const data = await this.#call({ op: "regions", method: "GET", path: "/regions", signal });
    return decodeRegionsData(data);
  }

  /** GET /info */
  async info(signal?: AbortSignal): Promise<DbInfo> {
    const data = await this.#call({ op: "info", method: "GET", path: "/info", signal });
    return decodeInfoData(data);
  }

  /** One logical request: attempts, retries, breaker, rate limit. Returns the raw "data" value. */
  async #call(call: Call): Promise<unknown> {
    let state = INITIAL_RETRY_STATE;
    for (;;) {
      try {
        return await this.#attempt(call);
      } catch (error) {
        if (!(error instanceof MothdexError)) throw error;
        const breakerOpen = this.#breaker.remaining(this.#opts.clock.now()) > 0;
        const plan = planRetry(error, state, this.#opts.maxRetries, breakerOpen, this.#opts.jitter);
        if (!plan.retry) throw error;
        await this.#sleep(call, plan.waitMs);
        state = plan.next;
      }
    }
  }

  async #attempt(call: Call): Promise<unknown> {
    const { op } = call;
    const remaining = this.#breaker.remaining(this.#opts.clock.now());
    if (remaining > 0) {
      throw new MothdexError({
        kind: "rate_limited",
        op,
        detail: "rate limit cooldown active",
        retryAfterMs: remaining,
      });
    }
    await this.#waitToken(call);
    try {
      return await this.#send(call);
    } catch (error) {
      if (error instanceof MothdexError && error.kind === "rate_limited") {
        throw this.#noteRateLimit(error);
      }
      throw error;
    }
  }

  /** Feeds the breach circuit; when it opens, the error carries the cooldown. */
  #noteRateLimit(error: MothdexError): MothdexError {
    const now = this.#opts.clock.now();
    const until = this.#breaker.record(now);
    if (until === undefined) return error;
    this.#opts.onBreach?.(until);
    return error.withRetryAfter(until - now);
  }

  async #waitToken(call: Call): Promise<void> {
    const delay = this.#bucket.reserve(this.#opts.clock.now());
    if (delay <= 0) return;
    try {
      await this.#sleep(call, delay);
    } catch (error) {
      this.#bucket.refund(this.#opts.clock.now());
      throw error;
    }
  }

  /** Sleeps through the injected sleeper; an abort of the caller's signal is "canceled". */
  async #sleep(call: Call, ms: number): Promise<void> {
    try {
      await this.#opts.sleeper(ms, call.signal);
    } catch (cause) {
      throw new MothdexError({ kind: "canceled", op: call.op, detail: "canceled", cause });
    }
  }

  async #send(call: Call): Promise<unknown> {
    const { op, method, path, body, signal } = call;
    const timeout = AbortSignal.timeout(this.#opts.timeoutMs);
    const attemptSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    const payload = method === "POST" ? JSON.stringify(body ?? {}) : undefined;
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": this.#opts.userAgent,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    };
    let raw: Awaited<ReturnType<typeof exchange>>;
    try {
      raw = await exchange(this.#opts.fetch, {
        op,
        method,
        url: joinPath(this.#opts.baseUrl, path),
        headers,
        payload,
        signal: attemptSignal,
      });
    } catch (cause) {
      throw this.#transportError(op, cause, signal, timeout);
    }
    return parseResponse(op, raw.status, raw.headers, raw.text, this.#opts.clock.now());
  }

  /** Cancelation by the caller is "canceled"; anything else, the timeout included, is "network". */
  #transportError(
    op: string,
    cause: unknown,
    signal: AbortSignal | undefined,
    timeout: AbortSignal,
  ): MothdexError {
    if (cause instanceof MothdexError) return cause;
    if (signal?.aborted)
      return new MothdexError({ kind: "canceled", op, detail: "canceled", cause });
    const detail = timeout.aborted ? "request timed out" : "network error";
    return new MothdexError({ kind: "network", op, detail, cause });
  }
}
