import { createHash } from "node:crypto";
import type { FetchFn } from "../../api/options";
import { DownloadFailure } from "../errors";
import type { HandleLike } from "./fs-seam";

/** Arms a timer; returns the function that cancels it. Injected so tests never sleep. */
export type Schedule = (ms: number, fire: () => void) => () => void;

export const systemSchedule: Schedule = (ms, fire) => {
  const timer = setTimeout(fire, ms);
  return () => clearTimeout(timer);
};

/** The proxy warms files up on demand and may stall up to 15 minutes (A2): the mothdex-cli defaults. */
export const FIRST_BYTE_TIMEOUT_MS = 10 * 60_000;
export const IDLE_TIMEOUT_MS = 5 * 60_000;

export interface TransferOptions {
  readonly url: URL;
  /** The catalog estimate (`link.size`, tools.md §3.4 step 3): it only sets the Content-Length band. */
  readonly size: number;
  readonly fetchFn: FetchFn;
  readonly schedule: Schedule;
  readonly signal: AbortSignal;
  readonly handle: HandleLike;
  /**
   * Called with the validated `Content-Length` (`cl`) before the first body byte: it re-runs the caps,
   * the budget and the space check, and throws a `DownloadFailure` to stop the call (T-27).
   */
  readonly onLength: (cl: number) => Promise<void>;
  readonly onProgress: (bytes: number, total: number) => void;
  readonly firstByteMs?: number;
  readonly idleMs?: number;
}

export interface TransferResult {
  readonly bytes: number;
  readonly sha256: string;
}

/** `Content-Length` may exceed the catalog size by 4 times plus this much, never more (T-27). */
const BAND_FLOOR = 256n * 1024n * 1024n;
export const clUpperBand = (size: number): bigint => 4n * BigInt(size) + BAND_FLOOR;

/** A strict decimal length of at least 1 that is a safe integer; anything else is undefined. */
function parseLength(header: string | null): number | undefined {
  if (header === null || !/^[1-9][0-9]*$/.test(header)) return undefined;
  const value = Number(header);
  return Number.isSafeInteger(value) ? value : undefined;
}

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Writes the whole of `chunk`, because a single `write` may stop short. */
async function writeAll(handle: HandleLike, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    offset += bytesWritten;
  }
}

/**
 * One GET of the proxy link into `handle` (tools.md §3.4 steps 8 to 10): no redirects, identity
 * encoding only, a strict `Content-Length` (`cl`) inside the band as the size authority (T-27),
 * decoded bytes counted and SHA-256 computed on the fly, abort at `cl + 1`, first-byte and idle
 * timeouts. Nothing is retried here.
 */
export async function transfer(options: TransferOptions): Promise<TransferResult> {
  const { size, handle } = options;
  const timeout = new AbortController();
  const signal = AbortSignal.any([options.signal, timeout.signal]);
  let timedOut = false;
  const arm = (ms: number): (() => void) =>
    options.schedule(ms, () => {
      timedOut = true;
      timeout.abort();
    });
  let disarm = arm(options.firstByteMs ?? FIRST_BYTE_TIMEOUT_MS);
  const failed = (): DownloadFailure =>
    options.signal.aborted ? new DownloadFailure("canceled") : new DownloadFailure("network");
  try {
    let response: Response;
    try {
      response = await options.fetchFn(options.url, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: { "accept-encoding": "identity" },
        signal,
      });
    } catch {
      throw failed();
    }
    const refuse = async (
      code: ConstructorParameters<typeof DownloadFailure>[0],
    ): Promise<never> => {
      await response.body?.cancel().catch(() => undefined);
      throw new DownloadFailure(code);
    };
    if (REDIRECTS.has(response.status)) return await refuse("untrusted_redirect");
    if (response.status === 404) return await refuse("not_found");
    if (response.status !== 200) return await refuse("upstream");
    const encoding = response.headers.get("content-encoding");
    if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
      return await refuse("size_mismatch");
    }
    const cl = parseLength(response.headers.get("content-length"));
    if (cl === undefined || BigInt(cl) > clUpperBand(size)) return await refuse("size_mismatch");
    if (response.body === null) return await refuse("size_mismatch");
    try {
      await options.onLength(cl);
    } catch (error) {
      await response.body.cancel().catch(() => undefined);
      throw error;
    }

    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        disarm();
        disarm = arm(options.idleMs ?? IDLE_TIMEOUT_MS);
        bytes += value.byteLength;
        if (bytes > cl) {
          await reader.cancel().catch(() => undefined);
          throw new DownloadFailure("size_mismatch");
        }
        hash.update(value);
        await writeAll(handle, value);
        options.onProgress(bytes, cl);
      }
    } catch (error) {
      // Whatever the reason, the body and its connection are released before the call fails.
      await reader.cancel().catch(() => undefined);
      if (error instanceof DownloadFailure) throw error;
      if (options.signal.aborted || timedOut) throw failed();
      throw error; // a write failure (ENOSPC, EDQUOT) is classified by the caller
    }
    if (bytes !== cl) throw new DownloadFailure("size_mismatch");
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    disarm();
  }
}
