import { type ErrorKind, isMothdexError } from "../api";

/** Codes of docs/contracts/mcp/tools.md "Errors". */
export type ToolErrorCode =
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "network"
  | "upstream"
  | "api_incompatible"
  | "untrusted_redirect"
  /** A bug on our side (cli-output.md §4 `internal`); not in the tools.md list yet. */
  | "internal";

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterS?: number;
}

/** A failure the tool layer raises itself, before any API call. */
export class InvalidRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequest";
  }
}

/**
 * Client kinds to tool codes. "api" (an `info.error` the client cannot place) is the service
 * failing, "decode" is an answer that is not API v1, and "canceled" never reaches the caller, who
 * cancelled: it is reported as a retryable network failure.
 */
const CODES: Readonly<Record<ErrorKind, ToolErrorCode>> = {
  network: "network",
  not_found: "not_found",
  invalid_request: "invalid_request",
  upstream: "upstream",
  api: "upstream",
  decode: "api_incompatible",
  api_incompatible: "api_incompatible",
  rate_limited: "rate_limited",
  canceled: "network",
  untrusted_redirect: "untrusted_redirect",
};

const RETRYABLE: ReadonlySet<ToolErrorCode> = new Set(["network", "upstream", "rate_limited"]);

/** Never leaks a stack trace or a cause: only the client's already cleaned message. */
export function toToolError(error: unknown): ToolError {
  if (error instanceof InvalidRequest) {
    return { code: "invalid_request", message: error.message, retryable: false };
  }
  if (isMothdexError(error)) {
    const code = CODES[error.kind];
    const retryAfterS =
      code === "rate_limited" && error.retryAfterMs > 0
        ? Math.ceil(error.retryAfterMs / 1000)
        : undefined;
    return {
      code,
      message: error.message,
      retryable: RETRYABLE.has(code),
      ...(retryAfterS === undefined ? {} : { retryAfterS }),
    };
  }
  return { code: "internal", message: "unexpected internal error", retryable: false };
}
