# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- T-24b: `release.yml` `publish` checks the tag against the built commit as its last step before the release is created
  (one API call per object), and refuses to upload files that `checksums.txt` does not list, same as mothdex-cli.

### Added

- Contracts (MCP-19-arch): tools.md §3 records the T-62 behaviour. An unset enable flag is silent, a preflight `lstat` returns `exists` before any connection, and the swapped-folder `.part` residual (case 16) is documented.
- Contracts (T-61): the `download_file` empty-name fallback uses the call's staging random part as `jobID`, and the shared `sanitize-vectors.json` fixture (mothdex-cli e8f79f6) applies as written, except that `allow_executable` vectors give `unsafe_name`.
- Contracts (T-61): `download_file` in tools.md §3 (registration, destination, input, link and transfer rules, staging and no-replace finalize, budgets, output, error codes, tests) and v0.2 distribution in plugin.md §5 (folder-as-opt-in, npm package rules, release order with trusted publishing, `.mcpb` and `server.json`), from Sentinela's T-60 CRs and D26.
- `docs/release.md`: owner checklist for the first release v0.1.0 (gates, settings, prepare PR, tag, verification of the
  published assets, marketplace pin, rollback) and what was not verified yet (T-23).
- T-60: threat model for the `download_file` tool and the v0.2.0 distribution (`docs/security/`), by Sentinela. It sets
  the contract changes (CR-1..CR-18) that must land before any download code.
- T-34: release pipeline. `release.yml` runs only for `v*` tags (tag on `main`, versions agree, lint, typecheck, tests,
  committed dist == build, smoke), attests the bundle and `checksums.txt` (GitHub build provenance) and, after the
  `release` environment approves, attaches `mothdex-mcp_<version>.mjs` and `checksums.txt` to the GitHub Release. No
  dependency cache, frozen lockfile, no install scripts, actions pinned by SHA. CI gains the check `dist == build(src)`
  and validates the marketplace manifest. `docs/release.md` documents verification, owner settings and the release
  steps, including pinning the marketplace `source` to the tag and commit. `publish` also checks that the tag still
  resolves to the built commit and verifies attestations with `--source-digest`; the staged release file is smoke-tested;
  CI lints the workflows with a pinned actionlint.

### Changed

- Tool input `slug` now uses the shared rule `^[a-z0-9][a-z0-9-]{0,255}$` (the same `SAFE_SLUG` as for API slugs) instead of
  length 1..256; other values are `invalid_request`.
- Contracts: tools follow the shared slug rule (`^[a-z0-9][a-z0-9-]{0,255}$`, api-client §2 in mothdex-cli). An unsafe
  slug in input is `invalid_request`, search drops such results with a warning, and a single-entry answer is
  `api_incompatible`.
- `dist/mothdex-mcp.mjs` is committed (a plugin git install now has its bundle) and excluded from lint. Version is
  `0.1.0` in `package.json` and `plugin.json` (not tagged yet).
- Node floor is 22 (`engines`, esbuild target `node22`), the oldest LTS still supported; the tools contract says so.
- Tools contract: client error kinds map to codes (adds `canceled` and `internal`), Node ≥ 22, and links on trusted
  hosts come first in `resolve_download`.
- A redirect the API client refuses (another origin, a scheme or port change, more than 3 hops) is now the
  non-retryable error kind `untrusted_redirect` instead of `network`; the message names only the target host.
- Tools contract: a refused redirect is the non-retryable error code `untrusted_redirect`, never `network`.

### Added

- T-32: contract tests of `docs/contracts/mcp/tools.md` through a real MCP client (the seven tools, the error table including `canceled` and `internal`, `isError` with `structuredContent`, resources, prompts, annotations, input limits) and a stdio smoke test of the built server (`pnpm smoke`, CI job `stdio smoke`) against a local fake API.
- `search_entries` writes one stderr line when it drops entries whose slug is unsafe (no API text in it).
- Claude Code plugin and marketplace (the repository is both): `.claude-plugin/plugin.json` and `marketplace.json`,
  `.mcp.json` pointing at the bundled `dist/mothdex-mcp.mjs`, and skills `mothdex` (model-invoked),
  `/mothdex:search`, `/mothdex:random` and `/mothdex:download` (resolves links, never downloads). A `plugin` CI job
  checks that plugin and package versions agree and runs `claude plugin validate . --strict` with Claude Code 2.1.330.
- A `node-floor` CI job runs lint, typecheck, tests and build on Node 22, the `engines` floor.
- Stdio MCP server on `@modelcontextprotocol/server` 2.4.0 (zod 4): read tools `search_entries`, `get_entry`,
  `random_entry`, `list_platforms`, `list_regions`, `db_info` and `resolve_download`; resources
  `mothdex://platforms`, `mothdex://regions` and `mothdex://entry/{slug}`; prompts `find_best_version` and
  `build_collection`. Compact outputs, an in-memory LRU cache (500 items) with the CLI's TTLs, errors as
  `isError` with `structuredContent.error`, host allowlist flag on download links. `--version` prints the version.
- TypeScript client for the Mothdex API v1 in `src/api/` (search, entry, random, platforms, regions, info), with the
  same rules as the Go client in mothdex-cli: envelope check with `info.error` on HTTP 200, error kinds, a token
  bucket at 5 req/s, a 429 breach circuit held in memory, bounded retries, `Cc`/`Cf` stripped from server messages,
  https only. No runtime dependencies.
- Copy of the mothdex-cli API fixtures in `src/api/testdata/api-v1/` and a `fixtures` CI job
  (`scripts/check-fixtures.mjs`, `pnpm check:fixtures`) that fails when the copy diverges from mothdex-cli `main`;
  `--update` refreshes the copy.
- Design documentation in `docs/`: contracts for the MCP tools, resources and prompts (SDK v2) and for the
  Claude Code plugin packaging; a copy of ADR-0001 (stack); research notes on the plugin spec and the MCP SDK.
- Project skeleton: pnpm, strict TypeScript, Biome, Vitest, esbuild bundle to
  `dist/mothdex-mcp.mjs`, minimal entry point that prints its version.
- GPL-3.0 license, governance documents, issue and pull request templates.
- CI for pull requests and `main` (install with frozen lockfile, lint, typecheck,
  test, build on Linux, Windows and macOS; `pnpm audit` of all
  dependencies, toolchain included; gitleaks) with actions pinned by commit SHA.
- Dependabot for npm and GitHub Actions.

[Unreleased]: https://github.com/Or4cu1o/mothdex-mcp/commits/main
