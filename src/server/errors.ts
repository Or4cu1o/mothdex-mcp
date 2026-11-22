import { type ErrorKind, isMothdexError, type MothdexError } from "../api";
import { cleanMessage } from "../api/parse";

/** Codes of docs/contracts/mcp/tools.md "Errors". */
export type ToolErrorCode =
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "network"
  | "upstream"
  | "api_incompatible"
  | "untrusted_redirect"
  /** The client cancelled the request (notifications/cancelled); normally never sent. */
  | "canceled"
  /** A bug on our side (cli-output.md §4 `internal`); not in the tools.md list yet. */
  | "internal"
  // download_file only (tools.md §3.8)
  | "no_destination"
  | "untrusted_url"
  | "unsafe_name"
  | "size_mismatch"
  | "path_rejected"
  | "disk_full"
  | "busy"
  | "quota_exceeded";

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

/** Fixed message and retryability per `download_file` code: nothing from upstream or Node reaches the model. */
export const DOWNLOAD_FAILURES = {
  no_destination: ["the download folder is not available", false],
  untrusted_url: ["the link is not on the download host", false],
  unsafe_name: ["the file name is not allowed", false],
  size_mismatch: ["the transfer did not match the announced size", false],
  path_rejected: ["the file could not be placed safely in the download folder", false],
  disk_full: ["not enough disk space", false],
  busy: ["another download is running", true],
  quota_exceeded: ["the download budget of this server run is used up", false],
  invalid_request: ["invalid request", false],
  not_found: ["entry or file not found", false],
  upstream: ["the file host answered with an error", true],
  network: ["the file transfer failed on the network", true],
  untrusted_redirect: ["the file host redirected the request", false],
  canceled: ["the request was canceled", false],
  internal: ["unexpected internal error", false],
} as const satisfies Readonly<Record<string, readonly [string, boolean]>>;

/** A `download_file` failure: the code picks the fixed message; detail only ever goes to the stderr log. */
export class DownloadFailure extends Error {
  readonly code: keyof typeof DOWNLOAD_FAILURES;
  readonly detail: string | undefined;
  constructor(code: keyof typeof DOWNLOAD_FAILURES, detail?: string) {
    super(DOWNLOAD_FAILURES[code][0]);
    this.name = "DownloadFailure";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Client kinds to tool codes (tools.md "Errors"). "api" (an `info.error` the client cannot place)
 * is the service failing but not worth retrying, "decode" is an answer that is not API v1, and
 * "canceled" is a cancel from the client; a server-side deadline already surfaces as "network".
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
  canceled: "canceled",
  untrusted_redirect: "untrusted_redirect",
};

const RETRYABLE: ReadonlySet<ErrorKind> = new Set(["network", "upstream", "rate_limited"]);

/** One fixed English message per code: nothing the upstream said reaches the model (it goes to the stderr log). */
const API_MESSAGES: Readonly<Record<ErrorKind, string>> = {
  network: "the request to the Mothdex API failed on the network",
  not_found: "entry not found",
  invalid_request: "the Mothdex API did not accept the request",
  upstream: "the Mothdex API answered with an error",
  api: "the Mothdex API answered with an error",
  decode: "the Mothdex API answered in a form this server does not understand",
  api_incompatible: "the Mothdex API answered in a form this server does not understand",
  rate_limited: "the Mothdex API rate limit was reached",
  canceled: "the request was canceled",
  untrusted_redirect: "the Mothdex API redirected the request to another place",
};

/** The stderr line for a client error: numbers, the upstream code and a message cut to 200 bytes. */
export function describeApiError(error: MothdexError): string {
  const code = error.code === "" ? "" : ` code ${error.code}`;
  const text = error.detail === "" ? "" : `: ${cleanMessage(error.detail, 200)}`;
  return `${error.op} failed: ${error.kind}${error.httpStatus === 0 ? "" : ` (HTTP ${error.httpStatus})`}${code}${text}`;
}

/** Never leaks a stack trace, a cause or an upstream message: the text is fixed per kind. */
export function toToolError(error: unknown): ToolError {
  if (error instanceof InvalidRequest) {
    return { code: "invalid_request", message: error.message, retryable: false };
  }
  if (error instanceof DownloadFailure) {
    return {
      code: error.code,
      message: error.message,
      retryable: DOWNLOAD_FAILURES[error.code][1],
    };
  }
  if (isMothdexError(error)) {
    const code = CODES[error.kind];
    const retryAfterS =
      code === "rate_limited" && error.retryAfterMs > 0
        ? Math.ceil(error.retryAfterMs / 1000)
        : undefined;
    return {
      code,
      message: API_MESSAGES[error.kind],
      retryable: RETRYABLE.has(error.kind),
      ...(retryAfterS === undefined ? {} : { retryAfterS }),
    };
  }
  return { code: "internal", message: "unexpected internal error", retryable: false };
}
