import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codeOf, copyExclusive } from "./fs-seam";
import { installShutdownHandlers } from "./shutdown";
import { DownloadState } from "./state";

const made: string[] = [];
afterEach(() => {
  for (const base of made.splice(0)) fs.rmSync(base, { recursive: true, force: true });
});
const dir = (): string => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mothdex-copy-"));
  made.push(base);
  return base;
};

/** The exclusive copy used when `link` is not available (Alicerce S1: no partial final file). */
describe("copyExclusive", () => {
  it("copies the bytes", async () => {
    const base = dir();
    fs.writeFileSync(path.join(base, "src"), "0123456789");
    await copyExclusive(path.join(base, "src"), path.join(base, "dst"));
    expect(fs.readFileSync(path.join(base, "dst"), "utf8")).toBe("0123456789");
  });

  it("a copy that fails midway leaves no final file", async () => {
    const base = dir();
    fs.writeFileSync(path.join(base, "src"), "0123456789");
    const full = (): never => {
      throw Object.assign(new Error("full"), { code: "ENOSPC" });
    };
    const error = await copyExclusive(path.join(base, "src"), path.join(base, "dst"), full).catch(
      (e: unknown) => e,
    );
    expect(codeOf(error)).toBe("ENOSPC");
    expect(fs.existsSync(path.join(base, "dst"))).toBe(false);
  });

  it("an existing name is EEXIST and is left exactly as it was", async () => {
    const base = dir();
    fs.writeFileSync(path.join(base, "src"), "new");
    fs.writeFileSync(path.join(base, "dst"), "mine");
    const error = await copyExclusive(path.join(base, "src"), path.join(base, "dst")).catch(
      (e: unknown) => e,
    );
    expect(codeOf(error)).toBe("EEXIST");
    expect(fs.readFileSync(path.join(base, "dst"), "utf8")).toBe("mine");
  });

  /** Sentinela M1 / Crivo n1: a signal in the middle of the copy fallback must not leave a truncated final file. */
  it.skipIf(process.platform === "win32")(
    "a signal in the middle of the copy removes the half-written final file",
    async () => {
      const base = dir();
      const source = path.join(base, "src");
      const target = path.join(base, "dst");
      fs.writeFileSync(source, Buffer.alloc(3 * 1024 * 1024, 1)); // three chunks
      const state = new DownloadState();
      const proc = new EventEmitter();
      const exits: number[] = [];
      installShutdownHandlers(state, {
        stdin: new EventEmitter(),
        proc: proc as never,
        exit: (c) => exits.push(c),
      });
      let signalled = false;
      await copyExclusive(
        source,
        target,
        (written) => {
          if (written >= 1024 * 1024 && !signalled) {
            signalled = true;
            expect(state.activeParts.has(target)).toBe(true); // registered from the O_EXCL open
            proc.emit("SIGTERM"); // the real handler exits the process; here the copy runs on
          }
        },
        state.activeParts,
      );
      expect(exits).toEqual([143]);
      expect(fs.existsSync(target)).toBe(false);
      expect(state.activeParts.size).toBe(0); // dropped once the copy returned
    },
  );

  it("the target is registered while copying and dropped when done", async () => {
    const base = dir();
    fs.writeFileSync(path.join(base, "src"), "abc");
    const active = new Set<string>();
    await copyExclusive(
      path.join(base, "src"),
      path.join(base, "dst"),
      () => expect(active.size).toBe(1),
      active,
    );
    expect(active.size).toBe(0);
  });
});
