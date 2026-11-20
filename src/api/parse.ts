import { type ApiInfo, classifyInfoError, classifyStatus, MothdexError } from "./errors";

export const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGE_BYTES = 200;

const STATUS_TEXT: ReadonlyMap<number, string> = new Map([
  [400, "Bad Request"],
  [404, "Not Found"],
  [429, "Too Many Requests"],
  [500, "Internal Server Error"],
  [502, "Bad Gateway"],
  [503, "Service Unavailable"],
  [504, "Gateway Timeout"],
]);

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;
/** HTTP dates start with a weekday name (IMF-fixdate, RFC 850, asctime); Date.parse accepts far more. */
const HTTP_DATE_PREFIX = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? /;
const DIGITS = /^[+-]?\d+$/;

/**
 * Defense in depth for server text that reaches a model or a terminal: drops Unicode
 * control (Cc) and format (Cf) characters, then bounds the length in UTF-8 bytes.
 * Only info.error goes through it; data fields stay raw.
 */
export function cleanMessage(text: string): string {
  const clean = text.replace(CONTROL_OR_FORMAT, "");
  let out = "";
  let bytes = 0;
  for (const char of clean) {
    bytes += Buffer.byteLength(char, "utf8");
    if (bytes > MAX_MESSAGE_BYTES) break;
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

function readInfo(raw: unknown): ApiInfo | undefined {
  if (raw === undefined || raw === null) return { error: "", code: "" };
  if (!isRecord(raw)) return undefined;
  const { error = "", code = "" } = raw;
  if (typeof error !== "string" || typeof code !== "string") return undefined;
  return { error, code };
}

function bestEffortMessage(text: string): string {
  const parsed = tryParseJson(text);
  if (!isRecord(parsed)) return "";
  const info = readInfo(parsed.info);
  return info === undefined ? "" : cleanMessage(info.error);
}

function statusError(
  op: string,
  status: number,
  headers: Headers,
  text: string,
  nowMs: number,
): MothdexError {
  const kind = classifyStatus(status);
  let detail = STATUS_TEXT.get(status) ?? `HTTP ${status}`;
  if (status === 400) detail = bestEffortMessage(text) || detail;
  const retryAfterMs = status === 429 ? parseRetryAfter(headers.get("retry-after"), nowMs) : 0;
  return new MothdexError({ kind, op, httpStatus: status, detail, retryAfterMs });
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
  if (info.error !== "" || info.code !== "") {
    throw new MothdexError({
      kind: classifyInfoError(info),
      op,
      httpStatus: status,
      detail: cleanMessage(info.error),
    });
  }
  return parsed.data;
}
