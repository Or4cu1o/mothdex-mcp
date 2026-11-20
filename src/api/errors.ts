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
  | "canceled";

export interface ErrorInit {
  readonly kind: ErrorKind;
  readonly op: string;
  /** 0 for transport errors. */
  readonly httpStatus?: number;
  /** info.error or transport text. Untrusted: for logs and tool output only. */
  readonly detail?: string;
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
  readonly retryAfterMs: number;

  constructor(init: ErrorInit) {
    const httpStatus = init.httpStatus ?? 0;
    const detail = init.detail ?? "";
    let message = `mothdex ${init.op}: ${init.kind}`;
    if (httpStatus !== 0) message += ` (HTTP ${httpStatus})`;
    if (detail !== "") message += `: ${detail}`;
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "MothdexError";
    this.kind = init.kind;
    this.op = init.op;
    this.httpStatus = httpStatus;
    this.detail = detail;
    this.retryAfterMs = init.retryAfterMs ?? 0;
  }

  /** A copy that carries a different cooldown. */
  withRetryAfter(retryAfterMs: number): MothdexError {
    return new MothdexError({
      kind: this.kind,
      op: this.op,
      httpStatus: this.httpStatus,
      detail: this.detail,
      retryAfterMs,
      cause: this.cause,
    });
  }
}

export function isMothdexError(value: unknown): value is MothdexError {
  return value instanceof MothdexError;
}

/** Known info.error messages. This table is the only place that matches text. */
const MESSAGE_KINDS: ReadonlyMap<string, ErrorKind> = new Map([
  ["Entry not found", "not_found"],
  ["Slug is required", "invalid_request"],
  ["Invalid input provided", "invalid_request"],
  ["Database operation failed", "upstream"],
  ["A database error occurred", "upstream"],
  ["An unexpected error occurred", "upstream"],
]);

/**
 * Known info.code values (our proposal U2, provisional). rate_limited is left out on
 * purpose: a 429 is classified by HTTP status. Unknown codes map to "api".
 */
const CODE_KINDS: ReadonlyMap<string, ErrorKind> = new Map([
  ["entry_not_found", "not_found"],
  ["invalid_request", "invalid_request"],
  ["database_error", "upstream"],
  ["internal_error", "upstream"],
]);

export interface ApiInfo {
  readonly error: string;
  readonly code: string;
}

/** Maps an HTTP 200 info.error to a kind. A code, when present, wins over the message. */
export function classifyInfoError(info: ApiInfo): ErrorKind {
  if (info.code !== "") return CODE_KINDS.get(info.code) ?? "api";
  return MESSAGE_KINDS.get(info.error) ?? "api";
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
