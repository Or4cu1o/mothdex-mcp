import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { promisify } from "node:util";

/** The part of a file handle the download needs. */
export interface HandleLike {
  write(data: Uint8Array, offset: number, length: number): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  chmod(mode: number): Promise<void>;
  close(): Promise<void>;
}

export interface StatLike {
  isDirectory(): boolean;
  isFile(): boolean;
  readonly mode: number;
  readonly mtimeMs: number;
}

/**
 * Every filesystem call of `download_file` goes through this seam, so tests can inject races
 * (a file appearing before finalize, a directory swapped for a symlink) and failures (`EPERM` on
 * `link`, `ENOSPC` on write) without touching the real disk layout.
 */
export interface DownloadFs {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<StatLike>;
  /** Does not follow a final symlink; a dangling link exists. */
  lstat(path: string): Promise<StatLike>;
  open(path: string, flags: number, mode: number): Promise<HandleLike>;
  link(existing: string, created: string): Promise<void>;
  /** Creates `target` exclusively (never replacing) and copies `source` into it; a failed copy leaves no `target`. */
  copyFileExcl(source: string, target: string, active?: Set<string>): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  /** Available bytes for unprivileged users. */
  freeBytes(path: string): Promise<bigint>;
}

const nativeRealpath = promisify(fs.realpath.native);

export const realFs: DownloadFs = {
  realpath: (path) => (process.platform === "win32" ? nativeRealpath(path) : fsp.realpath(path)),
  stat: (path) => fsp.stat(path),
  lstat: (path) => fsp.lstat(path),
  open: (path, flags, mode) => fsp.open(path, flags, mode),
  link: (existing, created) => fsp.link(existing, created),
  copyFileExcl: (source, target, active) => copyExclusive(source, target, undefined, active),
  unlink: (path) => fsp.unlink(path),
  readdir: (path) => fsp.readdir(path),
  freeBytes: async (path) => {
    const stats = await fsp.statfs(path, { bigint: true });
    return stats.bavail * stats.bsize;
  },
};

export const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

/** Open flags of the staging file: create-exclusive, never through a symlink where the OS can say so. */
export const STAGING_FLAGS =
  fs.constants.O_WRONLY |
  fs.constants.O_CREAT |
  fs.constants.O_EXCL |
  ((fs.constants as Record<string, number | undefined>).O_NOFOLLOW ?? 0);

const CHUNK_BYTES = 1024 * 1024;

/**
 * Exclusive copy: the target is created with `O_EXCL` (and `O_NOFOLLOW` where the OS has it), so an
 * existing name, also a dangling symlink, is `EEXIST` and is never touched. When the copy fails after
 * that point (ENOSPC, EIO) the partial target is removed, because this call created it. `onChunk`
 * lets a test make a copy fail midway.
 */
export async function copyExclusive(
  source: string,
  target: string,
  onChunk: (written: number) => void = () => {},
  active?: Set<string>,
): Promise<void> {
  const input = await fsp.open(source, "r");
  try {
    const mode = (await input.stat()).mode & 0o777;
    const output = await fsp.open(target, STAGING_FLAGS, mode); // EEXIST: nothing was created
    // From here until the copy is synced, the target is a staging file: a signal must remove it too (MT-14).
    active?.add(target);
    try {
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      let written = 0;
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, CHUNK_BYTES, null);
        if (bytesRead === 0) break;
        let offset = 0;
        while (offset < bytesRead) {
          offset += (await output.write(buffer, offset, bytesRead - offset)).bytesWritten;
        }
        written += bytesRead;
        onChunk(written);
      }
      await output.sync();
      await output.chmod(mode); // the open mode is subject to the umask; the part already carried the final one
    } catch (error) {
      await output.close().catch(() => undefined);
      await fsp.unlink(target).catch(() => undefined);
      active?.delete(target);
      throw error;
    }
    try {
      await output.close();
    } finally {
      active?.delete(target); // a finished file is no longer a staging file, even if close() throws
    }
  } finally {
    await input.close();
  }
}
