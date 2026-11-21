/**
 * Gaps found by hand mutation of the `download_file` guards (T-60 §6): each test here fails when
 * the mitigation it names is removed, which the tests of download.test.ts do not.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toToolError } from "../errors";
import { denyReason } from "./destination";
import { copyExclusive, realFs } from "./fs-seam";
import { prepareDownload } from "./setup";
import { makeRig, type Rig } from "./test-kit";

const made: string[] = [];
const rigs: Rig[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const rig of rigs.splice(0)) rig.cleanup();
});

const warnings = () => {
  const lines: string[] = [];
  return { lines, warn: (line: string) => void lines.push(line) };
};

describe("case 2: the folder must be absolute and free of an unresolved placeholder", () => {
  it("a relative folder that exists is refused, so nothing is ever written relative to the cwd", async () => {
    // A name that exists relative to the process cwd: only the absolute-path rule can refuse it.
    const inCwd = fs.mkdtempSync(path.join(process.cwd(), ".mothdex-rel-"));
    made.push(inCwd);
    const relative = path.basename(inCwd);
    expect(fs.existsSync(relative)).toBe(true);
    const w = warnings();
    const runtime = await prepareDownload(
      { MOTHDEX_MCP_ENABLE_DOWNLOAD: "1", MOTHDEX_DOWNLOAD_DIR: relative },
      w.warn,
    );
    expect(runtime).toBeUndefined();
    expect(w.lines.join("\n")).toContain("MOTHDEX_DOWNLOAD_DIR");
  });

  it("an existing absolute folder whose path holds the placeholder text is refused", async () => {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mothdex-ph-")));
    made.push(base);
    const folder = path.join(base, ["$", "{user_config.download_dir}"].join(""));
    fs.mkdirSync(folder);
    const w = warnings();
    const runtime = await prepareDownload(
      { MOTHDEX_MCP_ENABLE_DOWNLOAD: "1", MOTHDEX_DOWNLOAD_DIR: folder },
      w.warn,
    );
    expect(runtime).toBeUndefined();
    expect(w.lines.join("\n")).toContain("MOTHDEX_DOWNLOAD_DIR");
  });
});

describe("case 25: the transfer stops at byte size+1", () => {
  it("never writes a byte past the announced size, however long the body is", async () => {
    let written = 0;
    const rig = makeRig({
      replies: [
        { chunks: ["01234", "56789", "A", "BBBBBBBB", "CCCCCCCC", "DDDDDDDD"], length: 10 },
      ],
      fs: {
        open: async (file, flags, mode) => {
          const handle = await realFs.open(file, flags, mode);
          return {
            write: async (data, offset, length) => {
              const result = await handle.write(data, offset, length);
              written += result.bytesWritten;
              return result;
            },
            sync: () => handle.sync(),
            chmod: (m) => handle.chmod(m),
            close: () => handle.close(),
          };
        },
      },
    });
    rigs.push(rig);
    let code = "no error";
    try {
      await rig.run();
    } catch (error) {
      code = toToolError(error).code;
    }
    expect(code).toBe("size_mismatch");
    expect(written).toBeLessThanOrEqual(10);
    expect(rig.files()).toEqual([]);
  });
});

describe("case 20: the final mode honors the user's umask", () => {
  // run.ts reads the umask once, when it loads: reload the modules under each umask, as a server
  // started by a user with that umask would see it.
  it.skipIf(process.platform === "win32")(
    "a strict umask gives 0600, 0027 gives 0640 and the usual one 0644",
    async () => {
      const modeUnder = async (mask: number): Promise<number> => {
        const before = process.umask(mask);
        try {
          vi.resetModules();
          const kit = await import("./test-kit");
          const rig = kit.makeRig({});
          rigs.push(rig);
          const result = await rig.run();
          return fs.statSync(result.path).mode & 0o777;
        } finally {
          process.umask(before);
          vi.resetModules();
        }
      };
      expect(await modeUnder(0o077)).toBe(0o600);
      expect(await modeUnder(0o027)).toBe(0o640);
      expect(await modeUnder(0o022)).toBe(0o644);
    },
  );
});

describe("case 3: the /run roots that hold system state stay denied", () => {
  const ctx = { platform: "linux" as const, env: {} };
  it.each(["/run/user/1000/x", "/run/systemd/x", "/run/dbus/x", "/run/lock/x"])(
    "refuses %s",
    (target) => {
      expect(denyReason(target, "/home/u", ctx), target).toBeDefined();
    },
  );
});

describe("case 34: the copy fallback is registered for signal cleanup in the real flow", () => {
  it.skipIf(process.platform === "win32")(
    "run.ts hands the active set down to the copy, which holds the final name while writing",
    async () => {
      let registeredWhileCopying = false;
      const rig = makeRig({
        fs: {
          link: async () => {
            throw Object.assign(new Error("no hard links here"), { code: "EPERM" });
          },
          copyFileExcl: (source, target, active) =>
            copyExclusive(
              source,
              target,
              () => {
                registeredWhileCopying = active?.has(target) === true;
              },
              active,
            ),
        },
      });
      rigs.push(rig);
      const result = await rig.run();
      expect(result.status).toBe("done");
      expect(registeredWhileCopying).toBe(true);
      expect(rig.rt.state.activeParts.size).toBe(0);
    },
  );
  it.skipIf(process.platform === "win32")(
    "the real copy seam registers the final name too, not only the staging file",
    async () => {
      const rig = makeRig({
        fs: {
          link: async () => {
            throw Object.assign(new Error("no hard links here"), { code: "EXDEV" });
          },
        },
      });
      rigs.push(rig);
      const added: string[] = [];
      const active = rig.rt.state.activeParts;
      const add = active.add.bind(active);
      active.add = (value: string) => {
        added.push(value);
        return add(value);
      };
      const result = await rig.run();
      expect(result.status).toBe("done");
      expect(added).toContain(result.path);
      expect(active.size).toBe(0);
    },
  );
});
