### Changed

- T-77: `tools.md` Errors follows the upstream error codes of mothdex-cli `api-client.md` §3.1 (status first, exact
  `info.error` code, unknown code is `upstream` not retryable, old form kept, `RATE_LIMIT_ERROR` as a 429). The
  upstream message never reaches tool output: only the fixed message per code does, and the upstream text goes to the
  stderr log, sanitized and capped at 200 bytes.
