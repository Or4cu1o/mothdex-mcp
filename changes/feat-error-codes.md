### Changed

- T-77-mcp: the API client reads the upstream error code (mothdex-api 7a87af9: `info.error` is a code such as `ENTRY_NOT_FOUND`, `info.message` the text).
  An HTTP 200 code maps to a kind: `ENTRY_NOT_FOUND` to `not_found`; `INVALID_API_VERSION` to `api_incompatible`; `MALFORMED_JSON`,
  `INVALID_JSON_OBJECT`, `MISSING_REQUIRED_FIELDS`, `INVALID_FIELD_TYPE` and `INVALID_INPUT` to `invalid_request`; `DB_OPERATION_ERROR`, `DB_ERROR` and
  `UNEXPECTED_ERROR` to a retried `upstream`; `RATE_LIMIT_ERROR` to `rate_limited` with the 429 rules (Retry-After, circuit); any other code, `HTTP_ERROR` included,
  to the generic `api` kind. On a non-200 the HTTP status still decides, except a 400 with `INVALID_API_VERSION` (`api_incompatible`). The old text form of `info.error`
  still works, and `info.code` is ignored. `MothdexError` gains `code`.
- T-77-mcp: the MCP tool error message is now fixed English per code. The upstream message no longer reaches `structuredContent` or `text`; it goes to the stderr
  log only, with control, format and line-separator characters removed and cut to 200 bytes (the client error keeps up to 512 bytes and never uses it for logic).
