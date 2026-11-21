import * as path from "node:path";
import type { FetchFn } from "../../api/options";
import { DownloadFailure, InvalidRequest } from "../errors";
import { isTrustedHost } from "../links";
import { checkedEntry, type Env } from "../operations";
import { type DestinationContext, DestinationRejected, validateDestination } from "./destination";
import { placeWithoutReplacing } from "./finalize";
import { codeOf, type DownloadFs, type HandleLike, STAGING_FLAGS } from "./fs-seam";
import { NameRejected, sanitizeName } from "./sanitize";
import type { DownloadLimits } from "./settings";
import type { DownloadState } from "./state";
import { type Schedule, transfer } from "./transfer";

/** Downloads come from this host only, whatever MOTHDEX_ALLOWED_HOSTS says (D16, until E-v0.2-hosts). */
export const DOWNLOAD_HOST = "proxy.mothdex.net";
const MIB = 1024n * 1024n;
/** 0644 minus the umask, read once: `process.umask()` with no argument is documentation-deprecated (DEP0139). */
const FINAL_MODE = 0o644 & ~process.umask();
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const PART_NAME = /^\.mothdex-[a-z2-7]{26}$/;

export interface DownloadRuntime {
  /** MOTHDEX_DOWNLOAD_DIR as given; validated again at every call. */
  readonly rawDir: string;
  /** Its real path, resolved at startup. */
  readonly dest: string;
  readonly limits: DownloadLimits;
  readonly state: DownloadState;
  readonly fs: DownloadFs;
  readonly context: DestinationContext;
  readonly fetchFn: FetchFn;
  readonly schedule: Schedule;
  readonly randomBytes: (size: number) => Uint8Array;
  /** One line for the operator (stderr). Never a full URL, never raw API text. */
  readonly log: (line: string) => void;
  readonly firstByteMs?: number;
  readonly idleMs?: number;
}

export interface DownloadResult {
  readonly status: "done" | "exists";
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string | null;
  readonly crc: "skipped";
}

/** C0, DEL, C1, format characters and the line and paragraph separators (tools.md §3.7). */
export const stripControl = (text: string): string =>
  [...text].filter((char) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(char)).join("");

/** 128 random bits as 26 base32 characters. */
export function randomId(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

const partName = (id: string): string => `.mothdex-${id}.part`;

/** `ENOSPC` and `EDQUOT` are "disk_full"; anything else that is not already a failure stays as it is. */
function classify(error: unknown): unknown {
  const code = codeOf(error);
  return code === "ENOSPC" || code === "EDQUOT" ? new DownloadFailure("disk_full", code) : error;
}

async function currentDestination(rt: DownloadRuntime): Promise<string> {
  try {
    const real = await validateDestination(rt.rawDir, rt.context);
    if (real !== rt.dest) throw new DestinationRejected("the folder resolves elsewhere now");
    return real;
  } catch (error) {
    throw new DownloadFailure("no_destination", error instanceof Error ? error.message : undefined);
  }
}

async function entryAndLink(env: Env, slug: string, index: number) {
  const entry = checkedEntry("entry", await env.catalog.entry(slug, env.signal));
  const link = entry.links[index - 1];
  if (link === undefined) throw new InvalidRequest("link_index is past the end of the links");
  return { entry, link };
}

function sameHost(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.hostname === DOWNLOAD_HOST ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Opens the staging file `wx`-style; one new random name is tried when the first is taken. */
async function openStaging(
  rt: DownloadRuntime,
  dest: string,
  firstId: string,
): Promise<{ part: string; handle: HandleLike }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const part = path.join(dest, partName(attempt === 0 ? firstId : randomId(rt.randomBytes(16))));
    try {
      return { part, handle: await rt.fs.open(part, STAGING_FLAGS, 0o600) };
    } catch (error) {
      const code = codeOf(error);
      if (code === "EEXIST") continue;
      if (code === "ENOSPC" || code === "EDQUOT") throw classify(error);
      throw new DownloadFailure("path_rejected", code);
    }
  }
  throw new DownloadFailure("path_rejected", "staging name taken twice");
}

async function existsAlready(rt: DownloadRuntime, target: string): Promise<boolean> {
  try {
    await rt.fs.lstat(target);
    return true;
  } catch (error) {
    if (codeOf(error) === "ENOENT") return false;
    throw new DownloadFailure("path_rejected", codeOf(error));
  }
}

const existsResult = (target: string): DownloadResult => ({
  status: "exists",
  path: stripControl(target),
  bytes: 0,
  sha256: null,
  crc: "skipped",
});

const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** Free space check of tools.md §3.4 step 7, in BigInt. */
async function ensureSpace(rt: DownloadRuntime, dest: string, size: number): Promise<bigint> {
  const bytes = BigInt(size);
  const fivePercent = bytes / 20n;
  const floor = 256n * MIB;
  const margin = maxBig(fivePercent, floor);
  const free = await rt.fs.freeBytes(dest).catch((error: unknown) => {
    throw new DownloadFailure("disk_full", codeOf(error));
  });
  if (free - rt.state.ledger < bytes + margin)
    throw new DownloadFailure("disk_full", "not enough free space");
  return 2n * bytes;
}

/**
 * One `download_file` call, in the order of tools.md §3.4. Any failure stops the call; the staging
 * file, the name reservation and the ledger are released in `finally`.
 */
export async function runDownload(
  rt: DownloadRuntime,
  env: Env,
  args: { slug: string; link_index: number },
  onProgress: (bytes: number, total: number) => void,
): Promise<DownloadResult> {
  const { state } = rt;
  if (!state.tryAcquire()) throw new DownloadFailure("busy"); // synchronous: a second call never waits
  /** 26 base32 characters: the random part of the staging name and the last-resort file name (tools.md §3.4). */
  const jobId = randomId(rt.randomBytes(16));
  let reservedName: string | undefined;
  let reservedBytes = 0n;
  let part: string | undefined;
  let handle: HandleLike | undefined;
  try {
    const dest = await currentDestination(rt);
    const { entry, link } = await entryAndLink(env, args.slug, args.link_index);
    const url = sameHost(link.url);
    if (url === undefined || !isTrustedHost(link.url, env.allowedHosts)) {
      throw new DownloadFailure("untrusted_url");
    }
    const size = link.size;
    if (!Number.isSafeInteger(size) || size < 1 || size > rt.limits.fileBytes) {
      throw new InvalidRequest("the link size is not acceptable");
    }
    let name: string;
    try {
      name = sanitizeName(link.filename, { slug: entry.slug, format: link.format, jobId });
    } catch (error) {
      if (error instanceof NameRejected) throw new DownloadFailure("unsafe_name", error.reason);
      throw error;
    }
    const final = path.join(dest, name);
    if (!state.reserveName(name)) return existsResult(final);
    reservedName = name;
    if (await existsAlready(rt, final)) return existsResult(final);
    if (!state.withinBudget(size, rt.limits)) throw new DownloadFailure("quota_exceeded");
    reservedBytes = await ensureSpace(rt, dest, size);
    state.reserveBytes(reservedBytes);

    ({ part, handle } = await openStaging(rt, dest, jobId));
    state.activeParts.add(part);
    state.noteStarted(size);
    const signal =
      env.signal === undefined
        ? state.shutdown.signal
        : AbortSignal.any([env.signal, state.shutdown.signal]);
    const result = await transfer({
      url,
      size,
      fetchFn: rt.fetchFn,
      schedule: rt.schedule,
      signal,
      handle,
      onProgress: (bytes) => onProgress(bytes, size),
      ...(rt.firstByteMs === undefined ? {} : { firstByteMs: rt.firstByteMs }),
      ...(rt.idleMs === undefined ? {} : { idleMs: rt.idleMs }),
    });
    await handle.sync();
    // On the open handle, because a path-based chmod would follow a symlink. 0644 minus the user's umask (T-60 case 20).
    await handle.chmod(FINAL_MODE);
    await handle.close();
    handle = undefined;
    if ((await rt.fs.realpath(dest).catch(() => undefined)) !== dest) {
      throw new DownloadFailure("path_rejected", "the folder changed before finalize");
    }
    const placed = await placeWithoutReplacing(rt.fs, part, final, state.activeParts).catch(
      (error: unknown) => {
        // A link or copy error that is not EEXIST: a stable code, never an internal error (Alicerce S3).
        const mapped = classify(error);
        throw mapped instanceof DownloadFailure
          ? mapped
          : new DownloadFailure("path_rejected", codeOf(error));
      },
    );
    if (placed === "exists") return existsResult(final);
    state.noteCompleted();
    rt.log(`download ${jobId} done: host ${DOWNLOAD_HOST}, ${result.bytes} bytes`);
    return {
      status: "done",
      path: stripControl(final),
      bytes: result.bytes,
      sha256: result.sha256,
      crc: "skipped",
    };
  } catch (error) {
    const failure = classify(error);
    rt.log(
      `download ${jobId} failed: ${failure instanceof DownloadFailure ? `${failure.code}${failure.detail ? ` (${stripControl(failure.detail)})` : ""}` : (codeOf(failure) ?? "error")}`,
    );
    throw failure;
  } finally {
    await handle?.close().catch(() => undefined);
    if (part !== undefined) {
      await rt.fs.unlink(part).catch(() => undefined);
      state.activeParts.delete(part);
    }
    state.releaseBytes(reservedBytes);
    if (reservedName !== undefined) state.releaseName(reservedName);
    state.release();
  }
}

/** Startup cleanup: our own old staging files, directly in the folder, never followed. */
export async function cleanOrphans(fs: DownloadFs, dest: string, nowMs: number): Promise<void> {
  const DAY = 24 * 60 * 60 * 1000;
  for (const entry of await fs.readdir(dest).catch(() => [] as string[])) {
    if (!entry.endsWith(".part") || !PART_NAME.test(entry.slice(0, -".part".length))) continue;
    const file = path.join(dest, entry);
    try {
      const info = await fs.lstat(file);
      if (info.isFile() && nowMs - info.mtimeMs > DAY) await fs.unlink(file);
    } catch {
      // gone or not ours to remove: nothing to do
    }
  }
}
