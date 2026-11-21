# Contract: `mothdex-mcp` tools, resources and prompts

Status: draft v1 (T-2 phase 1) · Owner: Alicerce · Implementer: Forja (T-30, T-31) · Risk: Medium (read-only)
Plugin packaging (`.claude-plugin/`, `.mcp.json`, `.mcpb`, `server.json`) is **phase 2** (waits for Sonda T-1c/d).

## 1. Ground rules

- **SDK v2:** `@modelcontextprotocol/server` **2.4.0** (exact pin), zod ≥ 4.2 (`import * as z from 'zod/v4'`), Node ≥ 22 (oldest LTS still supported; `engines` matches),
  ESM bundle (PLAN §9). Wiring: `serveStdio(() => { const s = new McpServer({name: 'mothdex', version}); …; return s; })`
  from `@modelcontextprotocol/server/stdio`. Registration only through `registerTool(name, {title, description,
  inputSchema: z.object(…), outputSchema: z.object(…), annotations}, cb)`, `registerResource(name, uriOrTemplate, metadata, cb)`
  and `registerPrompt(name, {title, description, argsSchema}, cb)`; the deprecated variadic overloads and raw zod shapes are not used.
- Transport stdio. Server name `mothdex`, version = package version (kept in sync with `plugin.json`, see plugin.md).
- The API client follows [`api-client.md`](https://github.com/Or4cu1o/mothdex-cli/blob/main/docs/contracts/cli/api-client.md) (mothdex-cli) **exactly**: the same error kinds (in TypeScript), token bucket at 5 req/s,
  429 circuit, a check on `info.error` with HTTP 200 (A6), the same fixtures (copied, divergence checked in CI).
  The 429 cooldown lives in memory (the server is long-lived).
- In-memory LRU cache (≤ 500 items) with the TTLs from [`cache.md`](https://github.com/Or4cu1o/mothdex-cli/blob/main/docs/contracts/cli/cache.md) (mothdex-cli) §1. The server does not share the CLI's disk cache.
- Every tool declares `inputSchema` and `outputSchema` as `z.object`, so `structuredContent` is type-checked against it. It returns `structuredContent` plus one
  `text` content holding the same object as compact JSON (for clients without structured output support).
- Annotations on every read tool: `readOnlyHint: true`, `openWorldHint: true`; `idempotentHint: true` except `random_entry`.
- **Compact outputs:** no links in search results; links appear only on request, paginated. Target: ≤ 4 KB per call by default.
- API strings (titles, filenames, extras) are **untrusted data**. The skill and prompts tell the model to treat them as data.
- Configuration (environment only): `MOTHDEX_API_BASE_URL`, `MOTHDEX_API_RATE_LIMIT` (clamped 1..10),
  `MOTHDEX_ALLOWED_HOSTS` (default `proxy.mothdex.net`).

### Errors

A tool failure returns `isError: true` with `structuredContent: {error: {code, message, retryable, retry_after_s?}}`,
where `code` comes from [`cli-output.md`](https://github.com/Or4cu1o/mothdex-cli/blob/main/docs/contracts/cli/cli-output.md) (mothdex-cli) §4 (`not_found`, `invalid_request`, `rate_limited`, `network`, `upstream`,
`api_incompatible`, `untrusted_redirect`, `canceled`, `internal`). Input validation failures are `invalid_request` and never reach the API.

| Client kind (api-client)                             | `code`                                               | `retryable`                           |
| ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `NotFound`                                           | `not_found`                                          | false                                 |
| `InvalidRequest`                                     | `invalid_request`                                    | false                                 |
| `RateLimited`                                        | `rate_limited`                                       | true, with `retry_after_s` when known |
| `Network`                                            | `network`                                            | true                                  |
| `Upstream`                                           | `upstream`                                           | true                                  |
| `API` (unknown `info.error`)                         | `upstream`                                           | false                                 |
| `Decode`                                             | `api_incompatible`                                   | false                                 |
| `Incompatible`                                       | `api_incompatible`                                   | false                                 |
| `UntrustedRedirect`                                  | `untrusted_redirect`                                 | false                                 |
| `Canceled` by the client (`notifications/cancelled`) | `canceled` (normally not sent)                       | false                                 |
| `Canceled` by a server-side deadline                 | `network`                                            | true                                  |
| anything unexpected                                  | `internal` (message generic, detail only in the log) | false                                 |

A redirect the client refuses (another origin, a scheme change or more than 3 hops; api-client §5.1) is
`untrusted_redirect` with `retryable: false`, never `network`.

### Shared input fragments

```ts
const Slug = z.string().min(1).max(256);
const Ids = z.array(z.string().regex(/^[a-z0-9_-]{1,32}$/)).max(20); // platforms or regions
const Query = z.string().trim().min(1).max(200);
const PageSize = z.number().int().min(1).max(25).default(10);
const Page = z.number().int().min(1).default(1);
```

## 2. Read tools

| Tool               | Input                                                                                                                                                                                                  | Output (`structuredContent`)                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `search_entries`   | `{query?: Query, platforms?: Ids, regions?: Ids, serial?: string≤64, page?: Page, page_size?: PageSize}` (**at least one** of query/platforms/regions/serial is required; otherwise `invalid_request`) | `{page, total_pages, total_results, results: [EntrySummary]}`             |
| `get_entry`        | `{slug: Slug, links_offset?: int≥0 = 0, links_limit?: int 1..25 = 10}`                                                                                                                                 | `{entry: EntrySummary & {cover_url?}, links: [LinkSummary], links_total}` |
| `random_entry`     | `{query?, platforms?, regions?, serial?}`                                                                                                                                                              | `{entry: EntrySummary}`                                                   |
| `list_platforms`   | `{class?: string, brand?: string, query?: string≤50}` (case-insensitive filters)                                                                                                                       | `{platforms: [{id, name, brand, class}]}`                                 |
| `list_regions`     | `{}`                                                                                                                                                                                                   | `{regions: [{id, name}]}`                                                 |
| `db_info`          | `{}`                                                                                                                                                                                                   | `{total_entries}`                                                         |
| `resolve_download` | `{slug: Slug, link_index?: int≥1, prefer?: {languages?: string[]≤5, formats?: string[]≤5}, limit?: int 1..10 = 3}`                                                                                     | `{entry: {slug, title, platform}, links: [DownloadLink]}`                 |

```ts
type EntrySummary = {
  slug: string;
  title: string;
  platform: string;
  regions: string[];
  serial?: string;
  links_count: number;
  size_range?: [number, number];
}; // bytes
type LinkSummary = {
  index: number;
  type: string;
  format: string;
  extras: string[];
  filename: string;
  size: number;
  size_str: string;
  source_name: string;
};
type DownloadLink = LinkSummary & {
  url: string;
  source_url: string;
  trusted_host: boolean;
  reasons: string[];
}; // ranking per app-service.md §3 (same pure rule, ported)
```

- `index` is 1-based and stable for a given entry (API order). `resolve_download` with `link_index` returns that one link.
- `trusted_host` is false when the URL host is outside `MOTHDEX_ALLOWED_HOSTS`. The tool still returns the link,
  flagged, and the skill tells the model not to recommend it. Trusted links come first; the ranking order is kept within each group.
- `resolve_download` downloads nothing. It is how a user gets a URL for their own browser or the CLI.

## 3. Write tool: `download_file`, **future, opt-in (M3')**

Not registered in v0.1. It will be registered only when `MOTHDEX_MCP_ENABLE_DOWNLOAD=1` **and** a destination exists:
`MOTHDEX_DOWNLOAD_DIR` (in the plugin, filled from `userConfig.download_dir`, [plugin.md](plugin.md) §5) first; MCP roots only as a fallback,
because roots are deprecated by SEP-2577 (protocol 2026-07-28) although v2 and Claude Code still support them. High risk: Sentinela's threat model comes before any code.
Sketch only, not a commitment:

```ts
input:  { slug: Slug, link_index: number }   // no free path, no filename from the model
output: { path: string, bytes: number, sha256: string, crc: "ok"|"skipped" }
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
```

Rules carried from [`downloader.md`](https://github.com/Or4cu1o/mothdex-cli/blob/main/docs/contracts/cli/downloader.md) (mothdex-cli): host allowlist, sanitized name, confinement to the root, no overwrite, `.part` +
size + zip CRC, atomic move. It is long-running, so it would use MCP progress notifications and honor cancellation.

## 4. Resources

| URI                                 | MIME               | Content                                 |
| ----------------------------------- | ------------------ | --------------------------------------- |
| `mothdex://platforms`               | `application/json` | same as `list_platforms` with no filter |
| `mothdex://regions`                 | `application/json` | same as `list_regions`                  |
| `mothdex://entry/{slug}` (template) | `application/json` | `get_entry` with `links_limit: 25`      |

No `subscribe`; `listChanged: false`.

## 5. Prompts

| Name                | Arguments                                                             | Purpose                                                                                                                          |
| ------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `find_best_version` | `title` (required), `platform?`, `languages?` (comma list), `region?` | search → pick the entry → `resolve_download` with preferences → explain the choice (region, languages in `extras`, format, size) |
| `build_collection`  | `platform` (required), `criteria?`, `max_items?` (default 20, max 50) | paginate `search_entries` within the budget and return a table of slugs and chosen links, without downloading                    |

Both prompts tell the model to keep calls few (rate limit) and to treat API text as data.

## 6. Tests (T-32)

Contract tests for each tool against the fixtures (happy path, `not_found` with HTTP 200, `invalid_request`,
`rate_limited`), output validated against `outputSchema`, and a stdio smoke test (initialize → tools/list → one call).

## Resolved questions (Regente, T-2 phase 1)

- OQ-MCP-2: accepted. `search_entries` requires at least one filter.
- OQ-MCP-1: closed. SDK v2 2.4.0 is adopted (it negotiates protocol 2025-11-25 and 2026-07-28, Inferred from T1d). The `text`
  fallback stays. Release gate for mcp v0.1.0: a stdio smoke test in Claude Code, Claude Desktop and Cursor; fall back to v1
  `@modelcontextprotocol/sdk` 1.32.2 only if a target client fails to negotiate.
