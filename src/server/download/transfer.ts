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
  /** The announced size (`link.size`): the response must match it exactly. */
  readonly size: number;
  readonly fetchFn: FetchFn;
  readonly schedule: Schedule;
  readonly signal: AbortSignal;
  readonly handle: HandleLike;
  readonly onProgress: (bytes: number) => void;
  readonly firstByteMs?: number;
  readonly idleMs?: number;
}

export interface TransferResult {
  readonly bytes: number;
  readonly sha256: string;
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
 * encoding only, `Content-Length` equal to the announced size, decoded bytes counted and SHA-256
 * computed on the fly, abort at `size + 1`, first-byte and idle timeouts. Nothing is retried here.
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
    const declared = response.headers.get("content-length");
    if (declared === null || !/^[0-9]+$/.test(declared) || Number(declared) !== size) {
      return await refuse("size_mismatch");
    }
    if (response.body === null) return await refuse("size_mismatch");

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
        if (bytes > size) {
          await reader.cancel().catch(() => undefined);
          throw new DownloadFailure("size_mismatch");
        }
        hash.update(value);
        await writeAll(handle, value);
        options.onProgress(bytes);
      }
    } catch (error) {
      if (error instanceof DownloadFailure) throw error;
      if (options.signal.aborted || timedOut) throw failed();
      throw error; // a write failure (ENOSPC, EDQUOT) is classified by the caller
    }
    if (bytes !== size) throw new DownloadFailure("size_mismatch");
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    disarm();
  }
}
