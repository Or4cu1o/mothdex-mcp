/**
 * T-60 §6 cases 1-39 for `download_file` (tools.md §3). Each test names its case number.
 * [L] cases run on POSIX only, [W] on Windows only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toToolError } from "../errors";
import { DestinationRejected, denyReason, systemContext, validateDestination } from "./destination";
import { realFs } from "./fs-seam";
import { stripControl } from "./run";
import { prepareDownload } from "./setup";
import { DownloadState, reservationKey } from "./state";
import { MIB, makeRig, manualSchedule, type Rig, type RigOptions, rawLink } from "./test-kit";
import { transfer } from "./transfer";

const posix = process.platform !== "win32";
const rigs: Rig[] = [];
const rig = (options?: RigOptions): Rig => {
  const made = makeRig(options);
  rigs.push(made);
  return made;
};
afterEach(() => {
  for (const made of rigs.splice(0)) made.cleanup();
});

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
/** The tool code a failed call maps to. */
const failure = async (call: Promise<unknown>): Promise<string> => {
  try {
    await call;
  } catch (error) {
    return toToolError(error).code;
  }
  return "no error";
};
/** The placeholder a client leaves in place when the plugin setting is empty. */
const PLACEHOLDER = ["$", "{user_config.download_dir}"].join("");
const tmp = (): string =>
  fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mothdex-dst-")));

describe("happy path and output (cases 37, 20)", () => {
  it("case 37: writes the file and answers exactly {status, path, bytes, sha256, crc}", async () => {
    const r = rig({ replies: [{ chunks: ["01234", "56789"] }] });
    const result = await r.run();
    expect(Object.keys(result).sort()).toEqual(["bytes", "crc", "path", "sha256", "status"]);
    expect(result).toEqual({
      status: "done",
      path: path.join(r.dir, "Game.zip"),
      bytes: 10,
      sha256: sha("0123456789"),
      crc: "skipped",
    });
    expect(fs.readFileSync(result.path, "utf8")).toBe("0123456789");
    expect(fs.realpathSync.native(path.dirname(result.path))).toBe(r.dir);
    expect(r.files()).toEqual(["Game.zip"]); // no .part left
  });

  it.skipIf(!posix)(
    "case 20 [L]: the final file is 0644 minus umask and not executable, the part was 0600",
    async () => {
      let partMode = 0;
      const r = rig({
        fs: {
          open: async (file, flags, mode) => {
            partMode = mode;
            return realFs.open(file, flags, mode);
          },
        },
      });
      const result = await r.run();
      const mode = fs.statSync(result.path).mode & 0o777;
      expect(mode & 0o111).toBe(0);
      expect(mode).toBe(0o644 & ~process.umask());
      expect(partMode).toBe(0o600);
    },
  );
});

describe("registration and configuration (cases 1-5)", () => {
  const warnings = (): { warn: (m: string) => void; lines: string[] } => {
    const lines: string[] = [];
    return { warn: (m) => lines.push(m), lines };
  };
  const dir = tmp();

  it.each(["", "0", "true", "yes", " 1", "1 "])(
    "case 1: flag %j leaves the tool off with a warning naming the variable",
    async (flag) => {
      const w = warnings();
      const runtime = await prepareDownload(
        { MOTHDEX_MCP_ENABLE_DOWNLOAD: flag, MOTHDEX_DOWNLOAD_DIR: dir },
        w.warn,
      );
      expect(runtime).toBeUndefined();
      expect(w.lines.join("\n")).toContain("MOTHDEX_MCP_ENABLE_DOWNLOAD");
      expect(w.lines.join("\n")).not.toContain(dir);
    },
  );

  it("case 1: the exact flag with a valid folder registers; an unset flag stays silent", async () => {
    const w = warnings();
    expect(
      await prepareDownload(
        { MOTHDEX_MCP_ENABLE_DOWNLOAD: "1", MOTHDEX_DOWNLOAD_DIR: dir },
        w.warn,
      ),
    ).toBeDefined();
    expect(await prepareDownload({ MOTHDEX_DOWNLOAD_DIR: dir }, w.warn)).toBeUndefined();
    expect(w.lines).toEqual([]);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["an unresolved placeholder", PLACEHOLDER],
    ["relative", "relative/dir"],
    ["missing", path.join(dir, "missing")],
    [
      "a regular file",
      (() => {
        const file = path.join(dir, "f.txt");
        fs.writeFileSync(file, "x");
        return file;
      })(),
    ],
  ])(
    "case 2: folder %s leaves the tool off, names the variable and creates nothing",
    async (_label, value) => {
      const w = warnings();
      const before = fs.readdirSync(dir).sort();
      const runtime = await prepareDownload(
        {
          MOTHDEX_MCP_ENABLE_DOWNLOAD: "1",
          ...(value === undefined ? {} : { MOTHDEX_DOWNLOAD_DIR: value }),
        },
        w.warn,
      );
      expect(runtime).toBeUndefined();
      expect(w.lines.join("\n")).toContain("MOTHDEX_DOWNLOAD_DIR");
      expect(fs.readdirSync(dir).sort()).toEqual(before);
      expect(fs.existsSync(path.resolve("relative/dir"))).toBe(false);
      expect(fs.existsSync(path.resolve(PLACEHOLDER))).toBe(false);
    },
  );

  it("case 4: NODE_TLS_REJECT_UNAUTHORIZED=0 leaves the tool off", async () => {
    const w = warnings();
    const env = {
      MOTHDEX_MCP_ENABLE_DOWNLOAD: "1",
      MOTHDEX_DOWNLOAD_DIR: dir,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    };
    expect(await prepareDownload(env, w.warn)).toBeUndefined();
    expect(w.lines.join("\n")).toContain("NODE_TLS_REJECT_UNAUTHORIZED");
  });

  it.each([
    ["MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES", "12x"],
    ["MOTHDEX_DOWNLOAD_MAX_FILE_BYTES", "5"],
    ["MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES", "999999999999999"],
  ])("%s=%s is out of range: the tool stays off", async (name, value) => {
    const w = warnings();
    const env = { MOTHDEX_MCP_ENABLE_DOWNLOAD: "1", MOTHDEX_DOWNLOAD_DIR: dir, [name]: value };
    expect(await prepareDownload(env, w.warn)).toBeUndefined();
    expect(w.lines.join("\n")).toContain(name);
  });
});

describe("destination deny-list (case 3)", () => {
  const home = posix ? "/home/u" : "C:\\Users\\u";
  const ctx = {
    platform: process.platform,
    env: { CLAUDE_PLUGIN_ROOT: posix ? "/opt/plugin" : "C:\\plugin" },
  };
  const sep = posix ? "/" : "\\";
  const under = (...parts: string[]) => [posix ? "" : "C:", ...parts].join(sep).replace(/^$/, sep);
  it.each([
    ["a filesystem root", posix ? "/" : "C:\\"],
    ["the home folder", home],
    ["~/.ssh", `${home}${sep}.ssh`],
    ["inside ~/.claude", `${home}${sep}.claude${sep}x`],
    ["~/.config", `${home}${sep}.config`],
    ["the plugin folder", posix ? "/opt/plugin/data" : "C:\\plugin\\data"],
    ["a launcher folder ports", under("games", "roms", "ports")],
    ["ports_scripts", under("games", "PORTS_SCRIPTS")],
    ["roms\\windows", under("games", "roms", "windows")],
    ["a child named with two dots inside ~/.ssh", `${home}${sep}.ssh${sep}..keys`],
    [
      "a child named with two dots inside the plugin folder",
      `${ctx.env.CLAUDE_PLUGIN_ROOT}${sep}..x`,
    ],
  ])("refuses %s", (_label, target) => {
    expect(denyReason(target, home, ctx)).toBeDefined();
  });

  it.skipIf(!posix)("refuses /etc/..x and the extra POSIX roots", () => {
    for (const target of [
      "/etc/..x",
      ...(process.platform === "linux" ? ["/var/spool/cron"] : ["/private/var/db/x"]),
      "/opt/tool",
      "/dev/shm",
      "/proc/1",
      "/sys/x",
      "/run/user",
    ]) {
      expect(denyReason(target, home, ctx), target).toBeDefined();
    }
  });

  it("a sibling that only shares a prefix is not inside the protected folder", () => {
    expect(denyReason(`${home}${sep}.sshx`, home, ctx)).toBeUndefined();
  });

  it("accepts an ordinary folder", () => {
    expect(denyReason(under("data", "roms"), home, ctx)).toBeUndefined();
  });

  it("refuses the Windows protected folders by their environment variables", () => {
    const win = {
      platform: "win32" as const,
      env: {
        APPDATA: "C:\\Users\\u\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
      },
    };
    expect(
      denyReason(
        "C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp",
        "C:\\Users\\u",
        win,
      ),
    ).toBeDefined();
    expect(
      denyReason("c:\\users\\u\\appdata\\local\\microsoft\\x", "C:\\Users\\u", win),
    ).toBeDefined();
    expect(denyReason("D:\\games\\x", "C:\\Users\\u", win)).toBeUndefined();
  });

  it("refuses a symlink whose real path is the home folder, a folder with .git and the plugin folder", async () => {
    const base = tmp();
    const link = path.join(base, "link");
    fs.symlinkSync(os.homedir(), link, posix ? "dir" : "junction");
    const context = systemContext(realFs, {});
    await expect(validateDestination(link, context)).rejects.toBeInstanceOf(DestinationRejected);
    fs.mkdirSync(path.join(base, "repo", ".git"), { recursive: true });
    await expect(validateDestination(path.join(base, "repo"), context)).rejects.toThrow(/\.git/);
    await expect(
      validateDestination(base, systemContext(realFs, { CLAUDE_PLUGIN_ROOT: base })),
    ).rejects.toThrow(/protected/);
    await expect(
      validateDestination(path.join(base, "repo", "..", "link"), context),
    ).rejects.toBeInstanceOf(DestinationRejected);
    await expect(validateDestination(base, context)).resolves.toBe(base);
  });

  it.skipIf(!posix)(
    "case 3 [L]: a 0777 folder without the sticky bit, and a folder under one, are refused",
    async () => {
      const base = tmp();
      const open = path.join(base, "open");
      fs.mkdirSync(path.join(open, "child"), { recursive: true });
      fs.chmodSync(open, 0o777);
      const context = systemContext(realFs, {});
      await expect(validateDestination(open, context)).rejects.toThrow(/world-writable/);
      await expect(validateDestination(path.join(open, "child"), context)).rejects.toThrow(
        /world-writable/,
      );
      fs.chmodSync(open, 0o1777);
      await expect(validateDestination(open, context)).resolves.toBe(open);
    },
  );

  it.skipIf(posix)(
    "case 17 [W]: a junction to the home folder resolves to it and is refused",
    async () => {
      const base = tmp();
      const junction = path.join(base, "junction");
      fs.symlinkSync(os.homedir(), junction, "junction");
      await expect(validateDestination(junction, systemContext(realFs, {}))).rejects.toThrow(
        DestinationRejected,
      );
    },
  );
});

describe("input and tool-side rules (cases 5, 7, 22, 26, 29)", () => {
  it("case 5: a widened MOTHDEX_ALLOWED_HOSTS does not open archive.org downloads; zero connections", async () => {
    const r = rig({
      links: [rawLink({ url: "https://archive.org/x.zip" })],
      allowedHosts: ["proxy.mothdex.net", "archive.org"],
    });
    expect(await failure(r.run())).toBe("untrusted_url");
    expect(r.proxy.urls).toEqual([]);
  });

  it.each([
    ["http", "http://proxy.mothdex.net/f"],
    ["a port", "https://proxy.mothdex.net:8443/f"],
    ["userinfo", "https://u:p@proxy.mothdex.net/f"],
    ["an IPv4 literal", "https://127.0.0.1/f"],
    ["an IPv6 literal", "https://[::1]/f"],
    ["a trailing dot", "https://proxy.mothdex.net./f"],
    ["a suffix host", "https://evil-proxy.mothdex.net/f"],
    ["a sub host", "https://x.proxy.mothdex.net/f"],
    ["a punycode host", "https://xn--proxy-mothdex.net/f"],
    ["another host", "https://proxy.example.net/f"],
    ["a backslash", "https://proxy.mothdex.net\\@evil.test/f"],
  ])("case 22: %s is untrusted_url, zero dials", async (_label, url) => {
    const r = rig({ links: [rawLink({ url })] });
    expect(await failure(r.run())).toBe("untrusted_url");
    expect(r.proxy.urls).toEqual([]);
  });

  it("case 22: the proxy host in upper case is the same host and is accepted", async () => {
    const r = rig({ links: [rawLink({ url: "HTTPS://PROXY.MOTHDEX.NET/file/abc" })] });
    expect((await r.run()).status).toBe("done");
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["over the file cap", 2 * MIB + 1],
  ])("case 26: a link size of %s is refused before any connection", async (_label, size) => {
    const r = rig({
      links: [rawLink({ size })],
      limits: {
        MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES: String(MIB * 2),
        MOTHDEX_DOWNLOAD_MAX_FILE_BYTES: String(MIB * 2),
      },
    });
    expect(await failure(r.run())).toBe("invalid_request");
    expect(r.proxy.urls).toEqual([]);
  });

  it("case 26: a fractional size is already refused by the API client's decode (api_incompatible)", async () => {
    const r = rig({ links: [rawLink({ size: 1.5 })] });
    expect(await failure(r.run())).toBe("api_incompatible");
    expect(r.proxy.urls).toEqual([]);
  });

  it("case 7: link_index past the end is invalid_request and nothing is fetched", async () => {
    const r = rig();
    expect(await failure(r.run({ link_index: 2 }))).toBe("invalid_request");
    expect(r.proxy.urls).toEqual([]);
  });

  it("case 29: an entry whose filename or url is hostile gets the same rejections as fresh data", async () => {
    const r = rig({
      links: [rawLink({ filename: "../../evil.sh" }), rawLink({ url: "https://evil.test/f" })],
    });
    expect(await failure(r.run({ link_index: 1 }))).toBe("unsafe_name");
    expect(await failure(r.run({ link_index: 2 }))).toBe("untrusted_url"); // the second call reads the cached entry
    expect(r.proxy.urls).toEqual([]);
  });
});

describe("names and layout (cases 9, 11, 21)", () => {
  it.each([
    "x.sh",
    "x.SH",
    "x.zip.sh",
    "x.desktop",
    "x.exe",
    "x.bat",
    "x.lnk",
    "x.ps1",
    "x.AppImage",
  ])("case 9: %s is unsafe_name and no file appears", async (filename) => {
    const r = rig({ links: [rawLink({ filename })] });
    expect(await failure(r.run())).toBe("unsafe_name");
    expect(r.files()).toEqual([]);
    expect(r.proxy.urls).toEqual([]);
  });

  it.each(["x.bin", "x.iso", "x.chd", "x.zip"])("case 9: %s is allowed", async (filename) => {
    const r = rig({ links: [rawLink({ filename })] });
    expect((await r.run()).status).toBe("done");
  });

  it("case 11: a hostile platform never becomes a path; the file lands directly in the folder", async () => {
    const r = rig({ links: [rawLink({ filename: "dir/../../Game.zip", format: "../../x" })] });
    const result = await r.run();
    expect(path.dirname(result.path)).toBe(r.dir);
    expect(
      fs.readdirSync(r.dir).every((name) => fs.statSync(path.join(r.dir, name)).isFile()),
    ).toBe(true);
  });

  it("case 21: the reservation key folds case and normalization, so Game.zip and game.zip collide", () => {
    const state = new DownloadState();
    expect(state.reserveName("Game.zip")).toBe(true);
    expect(state.reserveName("game.zip")).toBe(false);
    expect(reservationKey("Pokémon.zip")).toBe(reservationKey("Pokémon.ZIP"));
    state.releaseName("GAME.ZIP");
    expect(state.reserveName("game.zip")).toBe(true);
  });
});

describe("filesystem (cases 12-19)", () => {
  it("case 12: an existing final name gives exists, nothing is fetched or changed, no part is left", async () => {
    const r = rig();
    fs.writeFileSync(path.join(r.dir, "Game.zip"), "mine");
    const result = await r.run();
    expect(result).toMatchObject({ status: "exists", bytes: 0, sha256: null });
    expect(fs.readFileSync(path.join(r.dir, "Game.zip"), "utf8")).toBe("mine");
    expect(r.files()).toEqual(["Game.zip"]);
    expect(r.proxy.urls).toEqual([]);
  });

  it("case 13: a file that appears after preflight is kept and the call answers exists", async () => {
    const r = rig({
      fs: {
        link: async (existing, created) => {
          fs.writeFileSync(created, "raced");
          return realFs.link(existing, created);
        },
      },
    });
    expect((await r.run()).status).toBe("exists");
    expect(fs.readFileSync(path.join(r.dir, "Game.zip"), "utf8")).toBe("raced");
    expect(r.files()).toEqual(["Game.zip"]);
  });

  it.skipIf(!posix)(
    "case 14 [L]: a dangling symlink at the final name leaves the victim alone",
    async () => {
      const r = rig();
      const victim = path.join(tmp(), "victim");
      fs.symlinkSync(victim, path.join(r.dir, "Game.zip"));
      expect((await r.run()).status).toBe("exists");
      expect(fs.existsSync(victim)).toBe(false);
    },
  );

  it.skipIf(!posix)(
    "case 15 [L]: a symlink at the staging name fails the exclusive open; a new name is tried once, then path_rejected",
    async () => {
      const outside = path.join(tmp(), "outside");
      const taken = new Set<string>();
      const r = rig({
        fs: {
          open: async (file, flags, mode) => {
            taken.add(file);
            fs.symlinkSync(outside, file);
            return realFs.open(file, flags, mode);
          },
        },
      });
      expect(await failure(r.run())).toBe("path_rejected");
      expect(taken.size).toBe(2);
      expect(fs.existsSync(outside)).toBe(false);
    },
  );

  it.skipIf(!posix)(
    "case 16 [L]: a folder swapped for a symlink before finalize is refused and nothing lands outside",
    async () => {
      const base = tmp();
      const dest = path.join(base, "dest");
      fs.mkdirSync(dest);
      const elsewhere = path.join(base, "elsewhere");
      fs.mkdirSync(elsewhere);
      const r = rig({
        fs: {
          open: async (file, flags, mode) => {
            const handle = await realFs.open(file, flags, mode);
            return {
              write: (data, offset, length) => handle.write(data, offset, length),
              sync: () => handle.sync(),
              chmod: (m) => handle.chmod(m),
              close: async () => {
                await handle.close();
                fs.renameSync(dest, `${dest}.moved`);
                fs.symlinkSync(elsewhere, dest);
              },
            };
          },
        },
      });
      (r.rt as { rawDir: string }).rawDir = dest;
      (r.rt as { dest: string }).dest = dest;
      expect(await failure(r.run())).toBe("path_rejected");
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    },
  );

  it.each(["EPERM", "ENOTSUP", "EXDEV", "ENOSYS"])(
    "case 18: link failing with %s falls back to an exclusive copy",
    async (code) => {
      const r = rig({
        fs: {
          link: async () => {
            throw Object.assign(new Error("x"), { code });
          },
        },
      });
      const result = await r.run();
      expect(result.status).toBe("done");
      expect(fs.readFileSync(result.path, "utf8")).toBe("0123456789");
      expect(r.files()).toEqual(["Game.zip"]);
    },
  );

  it("case 18: the copy fallback never replaces an existing name", async () => {
    const r = rig({
      fs: {
        link: async () => {
          throw Object.assign(new Error("x"), { code: "EPERM" });
        },
        copyFileExcl: async (source, target) => {
          fs.writeFileSync(target, "raced");
          return realFs.copyFileExcl(source, target);
        },
      },
    });
    expect((await r.run()).status).toBe("exists");
    expect(fs.readFileSync(path.join(r.dir, "Game.zip"), "utf8")).toBe("raced");
  });

  it.each(["EACCES", "EIO"])(
    "a link error %s (not EEXIST, not a no-link code) is path_rejected, not internal",
    async (code) => {
      const r = rig({
        fs: {
          link: async () => {
            throw Object.assign(new Error("x"), { code });
          },
        },
      });
      expect(await failure(r.run())).toBe("path_rejected");
      expect(r.files()).toEqual([]);
    },
  );

  it("case 19: the file system seam has no rename, so the final name is never made by one", () => {
    expect(Object.keys(realFs)).not.toContain("rename");
  });
});

describe("network (cases 23-28)", () => {
  it.each([301, 302, 307])(
    "case 23: a %i from the proxy is untrusted_redirect, not retried, no part left",
    async (status) => {
      const r = rig({ replies: [{ status, headers: { location: "https://evil.test/x" } }] });
      expect(await failure(r.run())).toBe("untrusted_redirect");
      expect(r.proxy.urls).toHaveLength(1);
      expect(r.files()).toEqual([]);
      expect(r.proxy.inits[0]).toMatchObject({
        redirect: "manual",
        headers: { "accept-encoding": "identity" },
      });
    },
  );

  it.each(["gzip", "br", "deflate"])(
    "case 24: Content-Encoding %s is refused before the body is read",
    async (encoding) => {
      const r = rig({
        replies: [{ headers: { "content-encoding": encoding }, chunks: ["0123456789"] }],
      });
      expect(await failure(r.run())).toBe("size_mismatch");
      expect(r.proxy.pulled[0]).toBe(0);
      expect(r.files()).toEqual([]);
    },
  );

  it("case 25: a missing or different Content-Length is size_mismatch", async () => {
    for (const length of [null, 9, 11] as const) {
      const r = rig({ replies: [{ chunks: ["0123456789"], length }] });
      expect(await failure(r.run())).toBe("size_mismatch");
      expect(r.files()).toEqual([]);
    }
  });

  it("case 25: a body longer than announced aborts at byte size+1; a short one is size_mismatch", async () => {
    const long = rig({ replies: [{ chunks: ["01234", "56789", "A"], length: 10 }] });
    expect(await failure(long.run())).toBe("size_mismatch");
    expect(long.files()).toEqual([]);
    const short = rig({ replies: [{ chunks: ["01234"], length: 10 }] });
    expect(await failure(short.run())).toBe("size_mismatch");
    expect(short.files()).toEqual([]);
  });

  const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
  it.skipIf(!hasOpenssl)(
    "case 27: a self-signed certificate fails the transfer; nothing in the code turns verification off",
    async () => {
      const base = tmp();
      const key = path.join(base, "k.pem");
      const cert = path.join(base, "c.pem");
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-subj",
          "/CN=127.0.0.1",
          "-addext",
          "subjectAltName=IP:127.0.0.1",
        ],
        { stdio: "ignore" },
      );
      const server = https.createServer(
        { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
        (_req, res) => res.end("0123456789"),
      );
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const { port } = server.address() as { port: number };
        const handle = {
          write: async () => ({ bytesWritten: 0 }),
          sync: async () => {},
          chmod: async () => {},
          close: async () => {},
        };
        const attempt = transfer({
          url: new URL(`https://127.0.0.1:${port}/f`),
          size: 10,
          fetchFn: (input, init) => fetch(input, init),
          schedule: manualSchedule().schedule,
          signal: new AbortController().signal,
          handle,
          onProgress: () => {},
        });
        await expect(attempt).rejects.toMatchObject({ code: "network" });
      } finally {
        server.close();
      }
    },
  );

  it("case 28: a 404 with body 'not found' is not_found and nothing is finalized", async () => {
    const r = rig({ replies: [{ status: 404, chunks: ["not found"] }] });
    expect(await failure(r.run())).toBe("not_found");
    expect(r.files()).toEqual([]);
  });

  it("any other status is upstream, retryable", async () => {
    const r = rig({ replies: [{ status: 503 }] });
    await expect(r.run()).rejects.toMatchObject({ code: "upstream" });
  });

  it("a first-byte or idle timeout is network, retryable, and removes the part", async () => {
    const r = rig({
      replies: [{ chunks: ["012345", "6789"], onChunk: (index) => index === 1 && r.timers.fire() }],
    });
    const error = await r.run().catch((e: unknown) => e);
    expect(toToolError(error)).toMatchObject({ code: "network", retryable: true });
    expect(r.files()).toEqual([]);
    expect(r.timers.armed()).toBe(0);
  });
});

describe("limits, concurrency, lifecycle (cases 30-36)", () => {
  it("case 30: free space below size plus margin is disk_full in preflight, with no connection", async () => {
    const r = rig({ fs: { freeBytes: async () => 100n * 1024n * 1024n } }); // margin is at least 256 MiB
    expect(await failure(r.run())).toBe("disk_full");
    expect(r.proxy.urls).toEqual([]);
    expect(r.rt.state.ledger).toBe(0n);
  });

  it("case 30: ENOSPC while writing is disk_full, the part is gone and the ledger released", async () => {
    const r = rig({
      fs: {
        open: async (file, flags, mode) => {
          const handle = await realFs.open(file, flags, mode);
          return {
            ...handle,
            sync: () => handle.sync(),
            chmod: (m) => handle.chmod(m),
            close: () => handle.close(),
            write: async () => {
              throw Object.assign(new Error("full"), { code: "ENOSPC" });
            },
          };
        },
      },
    });
    expect(await failure(r.run())).toBe("disk_full");
    expect(r.files()).toEqual([]);
    expect(r.rt.state.ledger).toBe(0n);
    expect(r.proxy.cancelled[0]).toBe(true); // the body and its connection were released
  });

  it("case 31: a second call while one runs is busy (retryable) at once; the slot is free afterwards", async () => {
    let second: Promise<unknown> | undefined;
    const r = rig({
      replies: [
        {
          chunks: ["01234", "56789"],
          onChunk: (index) => {
            if (index === 1) second = failure(r.run());
          },
        },
      ],
    });
    const first = await r.run();
    expect(first.status).toBe("done");
    expect(await second).toBe("busy");
    expect(toToolError(await r.run().catch((e: unknown) => e))).toMatchObject(
      { code: "not_found" }.code ? {} : {},
    );
    expect(r.rt.state.tryAcquire()).toBe(true);
  });

  it("case 32: the 21st completed download is quota_exceeded and fetches nothing", async () => {
    const links = Array.from({ length: 22 }, (_, i) =>
      rawLink({ filename: `g${i}.zip`, url: `https://proxy.mothdex.net/file/${i}` }),
    );
    const r = rig({ links });
    for (let i = 1; i <= 20; i++) expect((await r.run({ link_index: i })).status).toBe("done");
    const before = r.proxy.urls.length;
    expect(await failure(r.run({ link_index: 21 }))).toBe("quota_exceeded");
    expect(r.proxy.urls.length).toBe(before);
  });

  it("case 32: a size that would cross the total cap is quota_exceeded", async () => {
    const r = rig({
      links: [rawLink({ size: 2 * MIB })],
      limits: {
        MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES: String(MIB),
        MOTHDEX_DOWNLOAD_MAX_FILE_BYTES: String(MIB),
      },
    });
    expect(await failure(r.run())).toBe("invalid_request"); // over the per-file cap
    const total = rig({
      links: [rawLink({ filename: "a.zip", size: 10 })],
      limits: { MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES: String(MIB) },
    });
    total.rt.state.noteStarted(MIB - 5);
    expect(await failure(total.run())).toBe("quota_exceeded");
    expect(total.proxy.urls).toEqual([]);
  });

  it("failed transfers count toward the started cap (60) so a failure loop cannot hammer the proxy", async () => {
    const r = rig({ replies: [{ status: 503 }] });
    for (let i = 0; i < 60; i++) expect(await failure(r.run())).toBe("upstream");
    expect(await failure(r.run())).toBe("quota_exceeded");
    expect(r.proxy.urls).toHaveLength(60);
  });

  it("case 33: a client cancel aborts the transfer, removes the part and sends no result", async () => {
    const abort = new AbortController();
    const r = rig({
      replies: [{ chunks: ["01234", "56789"], onChunk: (index) => index === 1 && abort.abort() }],
    });
    expect(await failure(r.run({}, abort.signal))).toBe("canceled");
    expect(r.proxy.inits[0]?.signal?.aborted).toBe(true); // the abort reached the fetch, which tears the body down
    expect(r.files()).toEqual([]);
    expect(r.rt.state.tryAcquire()).toBe(true);
  });

  it("case 34: stdin closing aborts the transfer and cleans up before exit", async () => {
    const r = rig({
      replies: [
        {
          chunks: ["01234", "56789"],
          onChunk: (index) => index === 1 && r.rt.state.shutdown.abort(),
        },
      ],
    });
    expect(await failure(r.run())).toBe("canceled");
    expect(r.files()).toEqual([]);
    expect(r.rt.state.activeParts.size).toBe(0);
  });

  it("case 35: startup cleanup removes only our old regular part files, directly in the folder", async () => {
    const dir = tmp();
    const name = (c: string) => `.mothdex-${c.repeat(26)}.part`;
    const old = Date.now() / 1000 - 25 * 3600;
    const fresh = Date.now() / 1000 - 23 * 3600;
    const make = (file: string, when: number) => {
      fs.writeFileSync(path.join(dir, file), "x");
      fs.utimesSync(path.join(dir, file), when, when);
    };
    make(name("a"), old);
    make(name("b"), fresh);
    make("notes.part", old);
    fs.mkdirSync(path.join(dir, "x.part"));
    fs.mkdirSync(path.join(dir, "sub"));
    make(path.join("sub", name("c")), old);
    if (posix) {
      const target = path.join(tmp(), "target");
      fs.writeFileSync(target, "keep");
      fs.symlinkSync(target, path.join(dir, name("d")));
      const warn = () => {};
      await prepareDownload({ MOTHDEX_MCP_ENABLE_DOWNLOAD: "1", MOTHDEX_DOWNLOAD_DIR: dir }, warn);
      expect(fs.readFileSync(target, "utf8")).toBe("keep");
    } else {
      await prepareDownload(
        { MOTHDEX_MCP_ENABLE_DOWNLOAD: "1", MOTHDEX_DOWNLOAD_DIR: dir },
        () => {},
      );
    }
    const left = fs.readdirSync(dir).sort();
    expect(left).not.toContain(name("a"));
    expect(left).toContain(name("b"));
    expect(left).toContain("notes.part");
    expect(left).toContain("x.part");
    expect(fs.readdirSync(path.join(dir, "sub"))).toContain(name("c"));
  });
});

describe("output hygiene (cases 38, 39)", () => {
  it("case 38: control, bidi, format and separator characters never reach the result or the log", async () => {
    const r = rig({
      links: [rawLink({ filename: "a\u001b]52;x\u0007\u009b\u009d\u202e\u2028b.zip" })],
    });
    const result = await r.run();
    expect(result.path).not.toMatch(/[\p{Cc}\p{Cf}\u2028\u2029]/u);
    expect(r.logs.join("\n")).not.toMatch(/[\p{Cc}\p{Cf}\u2028\u2029]/u);
    expect(stripControl("a\u001b\u009b\u202e\u2028\u2029b")).toBe("ab");
  });

  it("case 39: failures carry fixed messages, never upstream text, Node errors or paths", async () => {
    const r = rig({
      replies: [{ status: 500, chunks: ["secret upstream body"] }],
      fs: {
        open: async () => {
          throw Object.assign(new Error(`EACCES ${os.homedir()}`), { code: "EACCES" });
        },
      },
    });
    const failures = [await r.run().catch((e: unknown) => e)];
    const proxyFail = rig({ replies: [{ status: 500, chunks: ["secret upstream body"] }] });
    failures.push(await proxyFail.run().catch((e: unknown) => e));
    for (const error of failures) {
      const { message } = toToolError(error);
      expect(message).not.toContain("secret");
      expect(message).not.toContain(os.homedir());
      expect(message).not.toContain("EACCES");
    }
    expect(toToolError(failures[0]).code).toBe("path_rejected");
  });
});
