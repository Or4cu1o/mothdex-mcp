import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildSync } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { installShutdownHandlers } from "./shutdown";
import { DownloadState } from "./state";

const posix = process.platform !== "win32";
const made: string[] = [];
afterEach(() => {
  for (const base of made.splice(0)) fs.rmSync(base, { recursive: true, force: true });
});
const dir = (): string => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mothdex-sig-"));
  made.push(base);
  return base;
};

/** T-60 MT-14 / cases 33-34: a closed stdin or a signal stops the transfer and removes the staging file. */
describe("shutdown handlers", () => {
  it("a stdin close aborts the transfer", () => {
    const state = new DownloadState();
    const stdin = new EventEmitter();
    installShutdownHandlers(state, { stdin, proc: new EventEmitter() as never, exit: () => {} });
    stdin.emit("close");
    expect(state.shutdown.signal.aborted).toBe(true);
  });

  it.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
    ["SIGHUP", 129],
  ])("%s aborts, removes the active staging files and exits with %i", (signal, code) => {
    const base = dir();
    const part = path.join(base, ".mothdex-aaaaaaaaaaaaaaaaaaaaaaaaaa.part");
    fs.writeFileSync(part, "partial");
    const state = new DownloadState();
    state.activeParts.add(part);
    const proc = new EventEmitter();
    const exits: number[] = [];
    installShutdownHandlers(state, {
      stdin: new EventEmitter(),
      proc: proc as never,
      exit: (c) => exits.push(c),
    });
    proc.emit(signal);
    expect(state.shutdown.signal.aborted).toBe(true);
    expect(fs.existsSync(part)).toBe(false);
    expect(exits).toEqual([code]);
  });

  it("the returned function removes every listener", () => {
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    const off = installShutdownHandlers(new DownloadState(), {
      stdin,
      proc: proc as never,
      exit: () => {},
    });
    off();
    expect(proc.eventNames()).toEqual([]);
    expect(stdin.eventNames()).toEqual([]);
  });

  /** A real process that is killed by a real SIGTERM while it holds a staging file. */
  it.skipIf(!posix)("a real SIGTERM leaves no staging file and exits 143", async () => {
    const base = dir();
    const part = path.join(base, ".mothdex-bbbbbbbbbbbbbbbbbbbbbbbbbb.part");
    const script = buildSync({
      stdin: {
        contents: `
          import { writeFileSync } from "node:fs";
          import { DownloadState } from "./state";
          import { installShutdownHandlers } from "./shutdown";
          const state = new DownloadState();
          writeFileSync(process.argv[2], "partial");
          state.activeParts.add(process.argv[2]);
          installShutdownHandlers(state);
          process.stdout.write("ready\\n");
          setInterval(() => {}, 1000);
        `,
        resolveDir: path.dirname(new URL(import.meta.url).pathname),
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
    }).outputFiles[0]?.text as string;
    const file = path.join(base, "child.mjs");
    fs.writeFileSync(file, script);
    const child = spawn(process.execPath, [file, part], { stdio: ["pipe", "pipe", "inherit"] });
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    expect(fs.existsSync(part)).toBe(true);
    const code = new Promise<number | null>((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    expect(await code).toBe(143);
    expect(fs.existsSync(part)).toBe(false);
  });
});
