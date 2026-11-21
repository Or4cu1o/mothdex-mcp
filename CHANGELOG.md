# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- A redirect the API client refuses (another origin, a scheme or port change, more than 3 hops) is now the
  non-retryable error kind `untrusted_redirect` instead of `network`; the message names only the target host.
- Tools contract: a refused redirect is the non-retryable error code `untrusted_redirect`, never `network`.

### Added

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
