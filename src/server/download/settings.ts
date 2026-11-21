const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

export const DEFAULT_TOTAL_BYTES = 64 * GIB;
export const DEFAULT_FILE_BYTES = 64 * GIB;
/** tools.md §3.6: completed downloads and started transfers per process. */
export const MAX_COMPLETED = 20;
export const MAX_STARTED = 60;

export interface DownloadLimits {
  readonly totalBytes: number;
  readonly fileBytes: number;
}

type Env = Readonly<Record<string, string | undefined>>;

function parseBytes(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined) return fallback;
  if (!/^[0-9]{1,15}$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= min && value <= max ? value : undefined;
}

/** The caps of tools.md §3.6, or the name of the variable that does not parse (the tool then stays off). */
export function parseLimits(env: Env): { limits: DownloadLimits } | { bad: string } {
  const totalBytes = parseBytes(
    env.MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES,
    DEFAULT_TOTAL_BYTES,
    MIB,
    TIB,
  );
  if (totalBytes === undefined) return { bad: "MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES" };
  const fileBytes = parseBytes(
    env.MOTHDEX_DOWNLOAD_MAX_FILE_BYTES,
    Math.min(DEFAULT_FILE_BYTES, totalBytes),
    MIB,
    256 * GIB,
  );
  if (fileBytes === undefined || fileBytes > totalBytes)
    return { bad: "MOTHDEX_DOWNLOAD_MAX_FILE_BYTES" };
  return { limits: { totalBytes, fileBytes } };
}
