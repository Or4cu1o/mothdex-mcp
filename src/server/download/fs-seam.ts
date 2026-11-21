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
  copyFileExcl(source: string, target: string): Promise<void>;
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
  copyFileExcl: (source, target) => fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL),
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
