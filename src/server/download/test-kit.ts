import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { FetchFn } from "../../api/options";
import { type FakeClock, makeClient } from "../../api/test-helpers";
import { TtlCache } from "../cache";
import { Catalog } from "../catalog";
import type { Env } from "../operations";
import { systemContext } from "./destination";
import { type DownloadFs, realFs } from "./fs-seam";
import { type DownloadResult, type DownloadRuntime, runDownload } from "./run";
import { parseLimits } from "./settings";
import { DownloadState } from "./state";
import type { Schedule } from "./transfer";

export const MIB = 1024 * 1024;

export interface RawLink {
  type: string;
  extras: string[];
  format: string;
  filename: string;
  url: string;
  size: number;
  size_str: string;
  source_name: string;
  source_url: string;
}

export const rawLink = (over: Partial<RawLink> = {}): RawLink => ({
  type: "Game",
  extras: [],
  format: "zip",
  filename: "Game.zip",
  url: "https://proxy.mothdex.net/file/abc",
  size: 10,
  size_str: "10B",
  source_name: "src",
  source_url: "https://example.org/",
  ...over,
});

export const entryBody = (links: RawLink[], slug = "game-1"): string =>
  JSON.stringify({
    info: {},
    data: {
      entry: {
        slug,
        title: "Game",
        platform: "dos",
        regions: [],
        serial: null,
        cover_url: "",
        links,
      },
    },
  });

export interface ProxyReply {
  status?: number;
  headers?: Record<string, string>;
  chunks?: (Uint8Array | string)[];
  /** Content-Length header; defaults to the sum of the chunks. */
  length?: number | null;
  /** Called while the body is read, to interleave an abort or a clock tick. */
  onChunk?: (index: number) => void;
}

/** What the fake proxy saw, and how far each body stream was read. */
export interface ProxyLog {
  urls: string[];
  inits: RequestInit[];
  pulled: number[];
}

const enc = new TextEncoder();
const bytes = (chunk: Uint8Array | string): Uint8Array =>
  typeof chunk === "string" ? enc.encode(chunk) : chunk;

export function fakeProxy(replies: ProxyReply[]): { fetchFn: FetchFn; log: ProxyLog } {
  const log: ProxyLog = { urls: [], inits: [], pulled: [] };
  const fetchFn: FetchFn = async (input, init) => {
    log.urls.push(input.toString());
    log.inits.push(init);
    const reply = replies[Math.min(log.urls.length - 1, replies.length - 1)] ?? {};
    const chunks = (reply.chunks ?? []).map(bytes);
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const slot = log.pulled.push(0) - 1;
    let next = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (init.signal?.aborted) {
            controller.error(new DOMException("aborted", "AbortError"));
            return;
          }
          const chunk = chunks[next];
          if (chunk === undefined) {
            controller.close();
            return;
          }
          reply.onChunk?.(next);
          log.pulled[slot] = (log.pulled[slot] ?? 0) + 1;
          next++;
          controller.enqueue(chunk);
        },
      },
      { highWaterMark: 0 },
    );
    const headers: Record<string, string> = { ...reply.headers };
    if (reply.length !== null) headers["content-length"] = String(reply.length ?? total);
    return new Response(body, { status: reply.status ?? 200, headers });
  };
  return { fetchFn, log };
}

/** A schedule that never fires on its own: tests call `fire` to simulate a timeout. */
export function manualSchedule(): { schedule: Schedule; fire: () => void; armed: () => number } {
  const timers = new Map<number, () => void>();
  let id = 0;
  return {
    schedule: (_ms, fire) => {
      const mine = id++;
      timers.set(mine, fire);
      return () => timers.delete(mine);
    },
    fire: () => {
      for (const fire of [...timers.values()]) fire();
    },
    armed: () => timers.size,
  };
}

export interface Rig {
  readonly dir: string;
  readonly rt: DownloadRuntime;
  readonly env: Env;
  readonly proxy: ProxyLog;
  readonly clock: FakeClock;
  readonly timers: ReturnType<typeof manualSchedule>;
  readonly logs: string[];
  run(args?: { slug?: string; link_index?: number }, signal?: AbortSignal): Promise<DownloadResult>;
  /** Names in the download folder. */
  files(): string[];
  cleanup(): void;
}

export interface RigOptions {
  links?: RawLink[];
  replies?: ProxyReply[];
  fs?: Partial<DownloadFs>;
  allowedHosts?: string[];
  limits?: Record<string, string>;
  onProgress?: (bytes: number, total: number) => void;
}

/** A real temporary folder, a scripted API entry and a scripted proxy. */
export function makeRig(options: RigOptions = {}): Rig {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mothdex-dl-")));
  const links = options.links ?? [rawLink()];
  const { client, clock } = makeClient([{ body: entryBody(links) }]);
  const catalog = new Catalog(client, new TtlCache(clock));
  const proxy = fakeProxy(options.replies ?? [{ chunks: ["0123456789"] }]);
  const timers = manualSchedule();
  const logs: string[] = [];
  const parsed = parseLimits(options.limits ?? {});
  if ("bad" in parsed) throw new Error("bad limits in a test");
  const memFs: DownloadFs = { ...realFs, ...options.fs };
  let counter = 0;
  const rt: DownloadRuntime = {
    rawDir: dir,
    dest: dir,
    limits: parsed.limits,
    state: new DownloadState(),
    fs: memFs,
    context: systemContext(memFs, {}),
    fetchFn: proxy.fetchFn,
    schedule: timers.schedule,
    randomBytes: (size) =>
      Uint8Array.from({ length: size }, (_, i) => (i * 7 + counter++ * 13) & 255),
    log: (line) => logs.push(line),
  };
  const env = (signal?: AbortSignal): Env => ({
    catalog,
    allowedHosts: new Set(options.allowedHosts ?? ["proxy.mothdex.net"]),
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    dir,
    rt,
    env: env(),
    proxy: proxy.log,
    clock,
    timers,
    logs,
    run: (args = {}, signal) =>
      runDownload(
        rt,
        env(signal),
        { slug: args.slug ?? "game-1", link_index: args.link_index ?? 1 },
        options.onProgress ?? (() => {}),
      ),
    files: () => fs.readdirSync(dir).sort(),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
