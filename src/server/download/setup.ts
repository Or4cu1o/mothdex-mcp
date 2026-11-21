import { randomBytes } from "node:crypto";
import type { FetchFn } from "../../api/options";
import {
  type DestinationContext,
  DestinationRejected,
  systemContext,
  validateDestination,
} from "./destination";
import { type DownloadFs, realFs } from "./fs-seam";
import { cleanOrphans, type DownloadRuntime } from "./run";
import { parseLimits } from "./settings";
import { DownloadState } from "./state";
import { type Schedule, systemSchedule } from "./transfer";

type Env = Readonly<Record<string, string | undefined>>;

export interface DownloadSeams {
  readonly fs?: DownloadFs;
  readonly fetchFn?: FetchFn;
  readonly schedule?: Schedule;
  readonly context?: DestinationContext;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly now?: () => number;
  readonly firstByteMs?: number;
  readonly idleMs?: number;
}

/**
 * The four conditions of tools.md §3.1, at startup. Returns the runtime when `download_file` is to
 * be registered; otherwise undefined plus one stderr warning that names the variable, never its value.
 */
export async function prepareDownload(
  env: Env,
  warn: (message: string) => void,
  seams: DownloadSeams = {},
): Promise<DownloadRuntime | undefined> {
  const flag = env.MOTHDEX_MCP_ENABLE_DOWNLOAD;
  if (flag === undefined) return undefined; // off by default, nothing to say
  if (flag !== "1") {
    warn("MOTHDEX_MCP_ENABLE_DOWNLOAD must be exactly 1: download_file is not registered");
    return undefined;
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    warn("NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS checks: download_file is not registered");
    return undefined;
  }
  const limits = parseLimits(env);
  if ("bad" in limits) {
    warn(`${limits.bad} is not a valid value: download_file is not registered`);
    return undefined;
  }
  const fs = seams.fs ?? realFs;
  const context = seams.context ?? systemContext(fs, env);
  let dest: string;
  try {
    dest = await validateDestination(env.MOTHDEX_DOWNLOAD_DIR, context);
  } catch (error) {
    const why = error instanceof DestinationRejected ? error.message : "unexpected error";
    warn(`MOTHDEX_DOWNLOAD_DIR is not usable (${why}): download_file is not registered`);
    return undefined;
  }
  await cleanOrphans(fs, dest, (seams.now ?? Date.now)());
  return {
    rawDir: env.MOTHDEX_DOWNLOAD_DIR as string,
    dest,
    limits: limits.limits,
    state: new DownloadState(),
    fs,
    context,
    fetchFn: seams.fetchFn ?? ((input, init) => fetch(input, init)),
    schedule: seams.schedule ?? systemSchedule,
    randomBytes: seams.randomBytes ?? ((size) => randomBytes(size)),
    log: (line) => warn(line),
    ...(seams.firstByteMs === undefined ? {} : { firstByteMs: seams.firstByteMs }),
    ...(seams.idleMs === undefined ? {} : { idleMs: seams.idleMs }),
  };
}
