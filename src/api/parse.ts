import {
  type ApiInfo,
  classifyInfoError,
  classifyStatus,
  type ErrorKind,
  isErrorCode,
  MothdexError,
} from "./errors";

export const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
/** Cap of the upstream message the client error carries; the stderr log cuts it again to 200 bytes. */
const MAX_MESSAGE_BYTES = 512;

const STATUS_TEXT: ReadonlyMap<number, string> = new Map([
  [400, "Bad Request"],
  [404, "Not Found"],
  [429, "Too Many Requests"],
  [500, "Internal Server Error"],
  [502, "Bad Gateway"],
  [503, "Service Unavailable"],
  [504, "Gateway Timeout"],
]);

/** Cc, Cf and the line and paragraph separators (Zl, Zp), which some log viewers treat as a line break. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
/** HTTP dates start with a weekday name (IMF-fixdate, RFC 850, asctime); Date.parse accepts far more. */
const HTTP_DATE_PREFIX = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? /;
const DIGITS = /^[+-]?\d+$/;

/**
 * Defense in depth for server text that reaches a terminal or a log: drops Unicode
 * control (Cc) and format (Cf) characters, then bounds the length in UTF-8 bytes (on a character boundary).
 * Only the upstream error message goes through it; data fields stay raw.
 */
export function cleanMessage(text: string, maxBytes: number = MAX_MESSAGE_BYTES): string {
  const clean = text.replace(CONTROL_OR_FORMAT, "");
  let out = "";
  let bytes = 0;
  for (const char of clean) {
    bytes += Buffer.byteLength(char, "utf8");
    if (bytes > maxBytes) break;
    out += char;
  }
  return out;
}

/** Reads delta-seconds or an HTTP date; unusable values give 0. Capped at 24 h. */
export function parseRetryAfter(value: string | null, nowMs: number): number {
  const text = (value ?? "").trim();
  if (text === "") return 0;
  if (DIGITS.test(text)) {
    const secs = Number(text);
    return secs <= 0 ? 0 : Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
  }
  if (!HTTP_DATE_PREFIX.test(text)) return 0;
  const date = Date.parse(text);
  if (Number.isNaN(date)) return 0;
  return Math.min(Math.max(date - nowMs, 0), MAX_RETRY_AFTER_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** An absent or null `info` is "no error". `info.error` must be a string and `info.message` is text or ignored; `info.code` is ignored. */
function readInfo(raw: unknown): ApiInfo | undefined {
  if (raw === undefined || raw === null) return { error: "", message: "" };
  if (!isRecord(raw)) return undefined;
  const { error = "", message } = raw;
  if (typeof error !== "string") return undefined;
  return { error, message: typeof message === "string" ? message : "" };
}

/** The code when `info.error` has the shape of one, else "". */
const codeOf = (info: ApiInfo | undefined): string =>
  info !== undefined && isErrorCode(info.error) ? info.error : "";

/** The human text: `info.message` next to a code, `info.error` itself in the old form. Cleaned and capped. */
const messageOf = (info: ApiInfo): string =>
  cleanMessage(isErrorCode(info.error) ? info.message : info.error);

function bestEffortInfo(text: string): ApiInfo | undefined {
  const parsed = tryParseJson(text);
  return isRecord(parsed) ? readInfo(parsed.info) : undefined;
}

function statusError(
  op: string,
  status: number,
  headers: Headers,
  text: string,
  nowMs: number,
): MothdexError {
  const info = bestEffortInfo(text);
  const code = codeOf(info);
  // The status decides the kind (A6); a code on a non-200 is only recorded, except a wrong API version.
  const kind: ErrorKind =
    status === 400 && code === "INVALID_API_VERSION" ? "api_incompatible" : classifyStatus(status);
  let detail = STATUS_TEXT.get(status) ?? `HTTP ${status}`;
  if (status === 400 && info !== undefined) detail = messageOf(info) || detail;
  const retryAfterMs = status === 429 ? parseRetryAfter(headers.get("retry-after"), nowMs) : 0;
  return new MothdexError({ kind, op, httpStatus: status, detail, code, retryAfterMs });
}

/**
 * The A6 rule: HTTP status first, then info.error. Returns the raw "data" value or throws a
 * MothdexError. Pure: no I/O, no clock.
 */
export function parseResponse(
  op: string,
  status: number,
  headers: Headers,
  text: string,
  nowMs: number,
): unknown {
  if (status !== 200) throw statusError(op, status, headers, text, nowMs);
  const parsed = tryParseJson(text);
  const info = isRecord(parsed) ? readInfo(parsed.info) : undefined;
  if (!isRecord(parsed) || info === undefined) {
    throw new MothdexError({
      kind: "decode",
      op,
      httpStatus: status,
      detail: "invalid JSON response",
    });
  }
  if (info.error !== "") {
    const kind = classifyInfoError(info);
    // RATE_LIMIT_ERROR is a 429 in disguise: same cooldown rules, Retry-After when the server sent one.
    const retryAfterMs =
      kind === "rate_limited" ? parseRetryAfter(headers.get("retry-after"), nowMs) : 0;
    throw new MothdexError({
      kind,
      op,
      httpStatus: status,
      detail: messageOf(info),
      code: codeOf(info),
      retryAfterMs,
    });
  }
  return parsed.data;
}
