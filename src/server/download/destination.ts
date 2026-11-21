import * as os from "node:os";
import * as path from "node:path";
import type { DownloadFs } from "./fs-seam";

/** The folder is not usable. The reason goes to the stderr log only, never to the model. */
export class DestinationRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DestinationRejected";
  }
}

export interface DestinationContext {
  readonly fs: DownloadFs;
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const LAUNCHER_FOLDERS: ReadonlySet<string> = new Set(["ports", "ports_scripts", "windows"]);
const HOME_DENY = [".ssh", ".gnupg", ".config", ".local/bin", ".claude", ".cursor", ".vscode"];
/** /var is a system folder on Linux; on macOS it is /private/var, where every user temp folder lives. */
const LINUX_DENY = ["/var"];
const DARWIN_DENY = ["/private/var/db", "/private/var/at", "/private/var/root"];
const POSIX_DENY = [
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/boot",
  "/System",
  "/Library",
  "/opt",
  "/dev",
  "/proc",
  "/sys",
  "/run/user",
  "/run/systemd",
  "/run/dbus",
  "/run/lock",
];

const flavor = (platform: NodeJS.Platform) => (platform === "win32" ? path.win32 : path.posix);
const foldCase = (platform: NodeJS.Platform) =>
  platform === "win32" || platform === "darwin"
    ? (text: string) => text.toLowerCase()
    : (text: string) => text;

/** Folders that must never hold downloads (tools.md §3.2); `base` is the resolved home folder. */
function deniedFolders(ctx: Pick<DestinationContext, "platform" | "env">, home: string): string[] {
  const p = flavor(ctx.platform);
  const denied = HOME_DENY.map((part) => p.join(home, ...part.split("/")));
  if (ctx.platform !== "win32") denied.push(...POSIX_DENY);
  if (ctx.platform === "linux") denied.push(...LINUX_DENY);
  if (ctx.platform === "darwin") denied.push(...DARWIN_DENY);
  const { APPDATA, LOCALAPPDATA, PROGRAMDATA, CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA } = ctx.env;
  const programFiles = [ctx.env.ProgramFiles, ctx.env["ProgramFiles(x86)"], ctx.env.SystemRoot];
  if (ctx.platform === "win32") {
    for (const base of programFiles) if (base) denied.push(base);
    for (const base of [APPDATA, LOCALAPPDATA && p.join(LOCALAPPDATA, "Microsoft")])
      if (base) denied.push(base);
    for (const base of [APPDATA, PROGRAMDATA]) {
      if (base)
        denied.push(p.join(base, "Microsoft", "Windows", "Start Menu", "Programs", "StartUp"));
    }
  }
  for (const dir of [CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA])
    if (dir && dir.trim() !== "") denied.push(dir);
  return denied;
}

/** Pure part of the deny-list: the reason a resolved path is refused, or undefined. */
export function denyReason(
  real: string,
  home: string,
  ctx: Pick<DestinationContext, "platform" | "env">,
  extraDenied: readonly string[] = [],
): string | undefined {
  const p = flavor(ctx.platform);
  const fold = foldCase(ctx.platform);
  const here = fold(p.normalize(real));
  const isInside = (parent: string): boolean => {
    const rel = p.relative(fold(p.normalize(parent)), here);
    // "..x" is a child named with two dots, not a parent; only ".." or "../" leaves the folder.
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel));
  };
  if (p.parse(real).root === real || here === fold(p.parse(real).root)) return "a filesystem root";
  if (here === fold(p.normalize(home))) return "the home folder itself";
  const all = [...deniedFolders(ctx, home), ...extraDenied];
  if (all.some(isInside)) return "inside a protected folder";
  const parts = here.split(p.sep);
  if (parts.some((part) => LAUNCHER_FOLDERS.has(part.toLowerCase()))) return "a launcher folder";
  return undefined;
}

async function exists(fs: DownloadFs, target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** POSIX: a world-writable folder without the sticky bit, or one below such a folder. */
async function worldWritableWithoutSticky(fs: DownloadFs, real: string): Promise<boolean> {
  for (let dir = real; ; dir = path.posix.dirname(dir)) {
    const { mode } = await fs.stat(dir);
    if ((mode & 0o002) !== 0 && (mode & 0o1000) === 0) return true;
    if (path.posix.dirname(dir) === dir) return false;
  }
}

/**
 * The checks of tools.md §3.2, run at startup and again at every call. Returns the real path
 * (`destReal`) or throws `DestinationRejected`. The folder is never created.
 */
export async function validateDestination(
  raw: string | undefined,
  ctx: DestinationContext,
): Promise<string> {
  const text = raw?.trim() ?? "";
  if (text === "") throw new DestinationRejected("not set");
  if (text.includes("${")) throw new DestinationRejected("unresolved placeholder");
  if (!flavor(ctx.platform).isAbsolute(text)) throw new DestinationRejected("not absolute");
  let real: string;
  try {
    real = await ctx.fs.realpath(text);
    if (!(await ctx.fs.stat(real)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new DestinationRejected("missing or not a folder");
  }
  const home = await ctx.fs.realpath(ctx.homedir).catch(() => ctx.homedir);
  const extra = await Promise.all(
    deniedFolders(ctx, home).map((dir) => ctx.fs.realpath(dir).catch(() => dir)),
  );
  const reason = denyReason(real, home, ctx, extra);
  if (reason !== undefined) throw new DestinationRejected(reason);
  if (await exists(ctx.fs, flavor(ctx.platform).join(real, ".git")))
    throw new DestinationRejected("holds a .git entry");
  if (ctx.platform !== "win32" && (await worldWritableWithoutSticky(ctx.fs, real))) {
    throw new DestinationRejected("world-writable without the sticky bit");
  }
  return real;
}

export const systemContext = (
  fs: DownloadFs,
  env: Readonly<Record<string, string | undefined>>,
): DestinationContext => ({
  fs,
  platform: process.platform,
  homedir: os.homedir(),
  env,
});
