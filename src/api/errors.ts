/** Failure classes of the API client. Callers branch on `kind`, never on message text. */
export type ErrorKind =
  | "network"
  | "not_found"
  | "invalid_request"
  | "upstream"
  | "api"
  | "decode"
  | "api_incompatible"
  | "rate_limited"
  | "canceled"
  /** A redirect the client refused (other origin, scheme change, more than 3 hops). Never retried. */
  | "untrusted_redirect";

export interface ErrorInit {
  readonly kind: ErrorKind;
  readonly op: string;
  /** 0 for transport errors. */
  readonly httpStatus?: number;
  /** The upstream message or transport text. Untrusted: for logs only, never for logic. */
  readonly detail?: string;
  /** The upstream error code (`info.error` in code form), already checked against `CODE_SHAPE`; "" when none. */
  readonly code?: string;
  /** rate_limited only; 0 when unknown. */
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}

/** The single error type thrown by the client. */
export class MothdexError extends Error {
  readonly kind: ErrorKind;
  readonly op: string;
  readonly httpStatus: number;
  readonly detail: string;
  readonly code: string;
  readonly retryAfterMs: number;

  constructor(init: ErrorInit) {
    const httpStatus = init.httpStatus ?? 0;
    const detail = init.detail ?? "";
    const code = init.code ?? "";
    let message = `mothdex ${init.op}: ${init.kind}`;
    if (httpStatus !== 0) message += ` (HTTP ${httpStatus})`;
    if (code !== "") message += `: ${code}`;
    if (detail !== "") message += `: ${detail}`;
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "MothdexError";
    this.kind = init.kind;
    this.op = init.op;
    this.httpStatus = httpStatus;
    this.detail = detail;
    this.code = code;
    this.retryAfterMs = init.retryAfterMs ?? 0;
  }

  /** A copy that carries a different cooldown. */
  withRetryAfter(retryAfterMs: number): MothdexError {
    return new MothdexError({
      kind: this.kind,
      op: this.op,
      httpStatus: this.httpStatus,
      detail: this.detail,
      code: this.code,
      retryAfterMs,
      cause: this.cause,
    });
  }
}

export function isMothdexError(value: unknown): value is MothdexError {
  return value instanceof MothdexError;
}

/** Known `info.error` texts of the old form (before upstream sent codes). The only place that matches text. */
const MESSAGE_KINDS: ReadonlyMap<string, ErrorKind> = new Map([
  ["Entry not found", "not_found"],
  ["Slug is required", "invalid_request"],
  ["Invalid input provided", "invalid_request"],
  ["Database operation failed", "upstream"],
  ["A database error occurred", "upstream"],
  ["An unexpected error occurred", "upstream"],
]);

/** An upstream error code: `info.error` in this shape is a code, matched exactly and case-sensitively. */
export const CODE_SHAPE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Upstream error codes (mothdex-api 7a87af9, api-docs "error-codes") sent with HTTP 200. `HTTP_ERROR` is
 * left out on purpose: its kind comes from the HTTP status, so on a 200 it is an unknown code ("api").
 */
const CODE_KINDS: ReadonlyMap<string, ErrorKind> = new Map([
  ["ENTRY_NOT_FOUND", "not_found"],
  ["INVALID_API_VERSION", "api_incompatible"],
  ["MALFORMED_JSON", "invalid_request"],
  ["INVALID_JSON_OBJECT", "invalid_request"],
  ["MISSING_REQUIRED_FIELDS", "invalid_request"],
  ["INVALID_FIELD_TYPE", "invalid_request"],
  ["INVALID_INPUT", "invalid_request"],
  ["DB_OPERATION_ERROR", "upstream"],
  ["DB_ERROR", "upstream"],
  ["UNEXPECTED_ERROR", "upstream"],
  ["RATE_LIMIT_ERROR", "rate_limited"],
]);

export interface ApiInfo {
  /** A code (`CODE_SHAPE`) or, in the old form, the message text. */
  readonly error: string;
  /** `info.message`: untrusted text for logs, never used for logic. */
  readonly message: string;
}

export const isErrorCode = (text: string): boolean => CODE_SHAPE.test(text);

/** Maps an HTTP 200 `info.error` to a kind: a code by exact match, any other text by the old table. */
export function classifyInfoError(info: ApiInfo): ErrorKind {
  const table = isErrorCode(info.error) ? CODE_KINDS : MESSAGE_KINDS;
  return table.get(info.error) ?? "api";
}

/** Maps a non-200 HTTP status to a kind. */
export function classifyStatus(status: number): ErrorKind {
  if (status === 400) return "invalid_request";
  if (status === 404) return "api_incompatible";
  if (status === 429) return "rate_limited";
  return "upstream";
}

/** Whether a failure of this kind may be retried with backoff. */
export function isRetryableKind(kind: ErrorKind): boolean {
  return kind === "upstream" || kind === "network";
}
