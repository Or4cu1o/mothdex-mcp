import pkg from "../../package.json" with { type: "json" };

export const DEFAULT_BASE_URL = "https://api.mothdex.net/v1";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_RATE_LIMIT = 5;
export const DEFAULT_BURST = 5;
export const DEFAULT_MAX_RETRIES = 2;
const MIN_RATE_LIMIT = 1;
const MAX_RATE_LIMIT = 10;
const MAX_MAX_RETRIES = 5;
const REPO_URL = "https://github.com/Or4cu1o/mothdex-mcp";

export type FetchFn = (input: URL, init: RequestInit) => Promise<Response>;

export interface Clock {
  now(): number;
}

/** Waits `ms` milliseconds; rejects when `signal` aborts. */
export type Sleeper = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface ClientOptions {
  /** https required; http only for loopback IP literals (tests). */
  readonly baseUrl?: string;
  readonly fetch?: FetchFn;
  /** Per-attempt timeout in ms. */
  readonly timeoutMs?: number;
  /** Requests per second, clamped to 1..10. */
  readonly rateLimit?: number;
  readonly burst?: number;
  /** Upstream and network retries, clamped to 0..5. */
  readonly maxRetries?: number;
  /** Generic; never put user data in it. */
  readonly userAgent?: string;
  readonly sleeper?: Sleeper;
  readonly clock?: Clock;
  /** Epoch ms that seeds the 429 circuit. */
  readonly cooldownUntilMs?: number;
  /** Called when the 429 circuit opens. */
  readonly onBreach?: (untilMs: number) => void;
  /** Returns a value in [0, maxMs]. */
  readonly jitter?: (maxMs: number) => number;
}

export interface ResolvedOptions {
  readonly baseUrl: URL;
  readonly fetch: FetchFn;
  readonly timeoutMs: number;
  readonly rateLimit: number;
  readonly burst: number;
  readonly maxRetries: number;
  readonly userAgent: string;
  readonly sleeper: Sleeper;
  readonly clock: Clock;
  readonly cooldownUntilMs: number;
  readonly onBreach: ((untilMs: number) => void) | undefined;
  readonly jitter: (maxMs: number) => number;
}

export function defaultUserAgent(version: string = pkg.version): string {
  return `mothdex-mcp/${version || "dev"} (+${REPO_URL})`;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Real sleeper: a timer that respects the abort signal. */
export const realSleeper: Sleeper = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export function resolveOptions(
  options: ClientOptions,
  parseBaseUrl: (raw: string) => URL,
): ResolvedOptions {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("mothdex: timeoutMs must be a positive integer");
  }
  for (const [name, value] of [
    ["rateLimit", options.rateLimit],
    ["burst", options.burst],
    ["maxRetries", options.maxRetries],
  ] as const) {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new Error(`mothdex: ${name} must be a finite number`);
    }
  }
  return {
    baseUrl: parseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    timeoutMs,
    rateLimit: clamp(options.rateLimit ?? DEFAULT_RATE_LIMIT, MIN_RATE_LIMIT, MAX_RATE_LIMIT),
    burst: Math.max(Math.trunc(options.burst ?? DEFAULT_BURST), 1),
    maxRetries: clamp(Math.trunc(options.maxRetries ?? DEFAULT_MAX_RETRIES), 0, MAX_MAX_RETRIES),
    userAgent: options.userAgent ?? defaultUserAgent(),
    sleeper: options.sleeper ?? realSleeper,
    clock: options.clock ?? { now: () => Date.now() },
    cooldownUntilMs: options.cooldownUntilMs ?? 0,
    onBreach: options.onBreach,
    jitter: options.jitter ?? ((maxMs) => Math.random() * maxMs),
  };
}
