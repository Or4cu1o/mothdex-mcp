import { codeOf, type DownloadFs } from "./fs-seam";

/** Hard links are not available here (FAT, exFAT, some FUSE, cross-device): copy with COPYFILE_EXCL instead. */
const NO_LINK_CODES: ReadonlySet<string | undefined> = new Set([
  "EPERM",
  "ENOTSUP",
  "ENOSYS",
  "EXDEV",
]);

/**
 * No-replace finalize (tools.md §3.5): the final name is created by `link` or by an exclusive
 * copy, never by `rename`, which would replace an existing file. `EEXIST`, also for a dangling
 * symlink, is "exists". The staging file is removed by the caller.
 */
export async function placeWithoutReplacing(
  fs: DownloadFs,
  part: string,
  final: string,
): Promise<"done" | "exists"> {
  try {
    await fs.link(part, final);
    return "done";
  } catch (error) {
    const code = codeOf(error);
    if (code === "EEXIST") return "exists";
    if (!NO_LINK_CODES.has(code)) throw error;
  }
  try {
    await fs.copyFileExcl(part, final);
    return "done";
  } catch (error) {
    if (codeOf(error) === "EEXIST") return "exists";
    throw error;
  }
}
