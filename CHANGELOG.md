# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-23

### Changed

- T-103: the bug report form asks for the component, how it was installed, the version, the system and device and logs, and the issue forms add the `needs-triage` label. `config.yml` keeps blank issues off and links Discussions (Q&A), the private security advisory page and https://mothdex.net. README links to the issue forms and to the beta testing guide.
- T-99: the marketplace entry is pinned to the v0.1.0 release (`source` github, ref `v0.1.0`, sha `468121cd380081d3e3126a3e59956fd98034510b`). README: install by npm, MCP registry name and the `.mcpb`; no more "nothing is released". `docs/release.md` records the first release (manual first npm and registry publish, the provenance 404, the npm `0.0.0-stage` placeholder) and drops the dormant wording.

### Fixed

- T-103: the bundle embeds only the `name` and `version` of `package.json` (an esbuild plugin in `scripts/build.mjs`), no longer its `scripts` and `devDependencies`; `check:package` fails if they come back. `dist` rebuilt. The icon check exercise gains the height-256 and shorter-than-24-bytes cases.

## [0.1.0] - 2026-11-22

### Fixed

- T-86: the downloader tests remove the temporary folders they create (`mothdex-copy-*`, `mothdex-sig-*`, `mothdex-dst-*`, `mothdex-dl-*`), so a test run no longer leaves hundreds of folders in `/tmp`.

### Changed

- T-76: a pull request no longer edits `CHANGELOG.md`: it adds `changes/<branch>.md` (see `changes/README.md`), and the release step runs
  `scripts/changelog-fold.sh` to fold the fragments into `CHANGELOG.md` and delete them, so open pull requests stop conflicting on the changelog. CI checks
  the fragments with `scripts/changelog-fold.sh --check`. `AGENTS.md`, `CONTRIBUTING.md`, the pull request template and the release checklist say so.
  The existing `CHANGELOG.md` content is untouched.
- T-77: `tools.md` Errors follows the upstream error codes of mothdex-cli `api-client.md` §3.1 (status first, exact
  `info.error` code, unknown code is `upstream` not retryable, old form kept, `RATE_LIMIT_ERROR` as a 429). The
  upstream message never reaches tool output: only the fixed message per code does, and the upstream text goes to the
  stderr log, sanitized and capped at 200 bytes.
- T-82: `plugin.md` §5.3 follows phase A and the T-82 threat model: the `.mcpb` holds exactly the manifest and the bundle
  until the icon exists; `id-token: write` sits on `attest`, `npm` and `registry` with separate environments (MP-1, MP-2);
  `mcp-publisher` is checked by its pinned hash, and by a signature when upstream publishes one (MP-8).
- T-82: `plugin.md` §5.3 lists the full release asset set of phase B: the `.mjs`, the `.mcpb`, the npm `.tgz` and `server.json`, all in
  `checksums.txt` and attested; the GitHub release holds exactly that set.
- T-77-mcp: the API client reads the upstream error code (mothdex-api 7a87af9: `info.error` is a code such as `ENTRY_NOT_FOUND`, `info.message` the text).
  An HTTP 200 code maps to a kind: `ENTRY_NOT_FOUND` to `not_found`; `INVALID_API_VERSION` to `api_incompatible`; `MALFORMED_JSON`,
  `INVALID_JSON_OBJECT`, `MISSING_REQUIRED_FIELDS`, `INVALID_FIELD_TYPE` and `INVALID_INPUT` to `invalid_request`; `DB_OPERATION_ERROR`, `DB_ERROR` and
  `UNEXPECTED_ERROR` to a retried `upstream`; `RATE_LIMIT_ERROR` to `rate_limited` with the 429 rules (Retry-After, circuit); any other code, `HTTP_ERROR` included,
  to the generic `api` kind. On a non-200 the HTTP status still decides, except a 400 with `INVALID_API_VERSION` (`api_incompatible`). The old text form of `info.error`
  still works, and `info.code` is ignored. `MothdexError` gains `code`.
- T-77-mcp: the MCP tool error message is now fixed English per code. The upstream message no longer reaches `structuredContent` or `text`; it goes to the stderr
  log only, with control, format and line-separator characters removed and cut to 200 bytes (the client error keeps up to 512 bytes and never uses it for logic).

- T-63: `download_file` implements T-27. A missing, chunked, `0` or malformed `Content-Length` is `size_mismatch`, as is one above `4 × link.size + 256 MiB` or the per-file cap; the total-bytes budget (`quota_exceeded`) and the space ledger (`disk_full`, claim `2 × cl`) re-run on it before the first body byte; `bytes` and progress `total` equal it, and a large drift from `link.size` logs one stderr line.
- `download_file` contract (T-27, tools.md §3.4, T-60): the proxy's `Content-Length` is the size authority, because the maintainer states `link.size` is scraped and only a rough indicator (cavv-dev/mothdex-api#1). The length is required and strict, capped by the fixed `CL_UPPER_BAND = 4 × link.size + 256 MiB`, and the per-file cap, the total-bytes budget and the space check re-run on it before the body; `bytes` and progress `total` equal it. `link.size` stays a preflight estimate.
- T-24b: `release.yml` `publish` checks the tag against the built commit as its last step before the release is created
  (one API call per object), and refuses to upload files that `checksums.txt` does not list, same as mothdex-cli.

### Added

- T-82 phase A: the release also builds a `.mcpb` (MCP Bundle) of the committed bundle, packed and validated with the pinned `@anthropic-ai/mcpb` (own project and frozen lockfile in `tools/mcpb`, install scripts off),
  checked to hold exactly the manifest and the bundle (byte for byte the committed files, smoke test of the bundle inside it), listed in `checksums.txt`, attested like the other release file and uploaded with
  the release. `pnpm check:package` runs in the release build too, and `scripts/pack-mcpb.sh` runs in the existing `dist == build(src)` CI job, so no new check name. `docs/release.md` gains the design of the npm and
  MCP registry publishing (not implemented) and the list of what the owner must configure.
- T-82 phase B: `release.yml` gets the `npm` job (environment `release`, trusted publishing, no checkout, empty npm config and `registry.npmjs.org` forced, the verified tarball published by path with `--ignore-scripts`,
  integrity, `npm audit signatures` and provenance checked after) and the `registry` job (its own environment `mcp-registry`, no checkout, the pinned `mcp-publisher` verified by SHA-256 and its Sigstore bundle, `server.json`
  generated with `jq` from the verified files, `login github-oidc`). The build job now also packs the npm tarball and attests it with the committed `server.json`. Dormant while `private: true` and until the owner
  configures the environments and the trusted publisher. `scripts/exercise-release-steps.py` exercises the non-publishing steps in CI; `scripts/pack-mcpb.sh` also pins every supply-chain setting and the accepted
  advisories of `tools/mcpb`. `scripts/check-package.mjs` lets `private` be false only when the changelog has that version's section. A pre-release tag skips both publishing jobs. The release docs describe it, the partial-publish recovery and the owner settings.
- T-82: threat model of the npm publish and MCP registry jobs (`docs/security/T-82-threat-model-mcp-publish.md`).
- T-85: the `.mcpb` now carries its icon: `mcpb/icon.png` (512x512, the project-owned art approved in D30), referenced by `mcpb/manifest.json` as `icon`. `scripts/pack-mcpb.sh` stages it, expects exactly three members (`manifest.json`, `icon.png`, `dist/mothdex-mcp.mjs`),
  compares each byte for byte with the committed file and checks the PNG with `scripts/check-icon.mjs` (signature, IHDR first, 512x512, the 12-byte IEND at the end so a truncated file fails; also used by `check-package.mjs`; missing file gives a message, not a stack trace); `mcpb validate` passes with the icon. `scripts/check-package.mjs` checks the manifest reference and the PNG too. `docs/release.md` and `plugin.md` 5.3 give the new list,
  and plugin.md 5.3 says a pre-release tag is a GitHub pre-release only (the npm and registry jobs are skipped for it).

- T-66: distribution metadata for the next release, preparation only (nothing is published). `package.json` gets `mcpName`, `bin`, `files`
  (`dist/mothdex-mcp.mjs`, `README.md`, `LICENSE`) and `publishConfig` (public, provenance); `@modelcontextprotocol/server` and
  `zod` move to `devDependencies` because the bundle is self-contained; the package stays `private: true` until the release PR.
  New `server.json` (MCP registry) and `mcpb/manifest.json` (spec 0.3), both with no default for the download folder.
  `scripts/check-versions.mjs` also checks them, and `pnpm check:package` checks the `npm pack --dry-run` list, no runtime
  dependencies, no lifecycle scripts and `mcpName` against `server.json`, and the node shebang on the first line of the dist (the build now adds it, so `npx mothdex-mcp` starts). The npm name is `mothdex-mcp` (free on npm on 2026-11-22).
- T-62: opt-in `download_file` tool (tools.md §3, threat model T-60). Registered only with `MOTHDEX_MCP_ENABLE_DOWNLOAD=1`
  and a valid `MOTHDEX_DOWNLOAD_DIR` (deny-lists, re-checked each call and before finalize). Input is `{slug, link_index}`
  only; proxy host only, no redirects, identity encoding, `Content-Length` equal to the link size, abort at size+1; a
  byte-exact port of the CLI `Sanitize` checked against the shared `sanitize-vectors.json` (`check-fixtures` compares it);
  staging file `O_EXCL|O_NOFOLLOW`, finalize by `link` or an exclusive copy, never `rename`; one download at a time,
  per-process budgets, disk-space ledger, cancel and stdin-close cleanup, progress notifications. New error codes
  `no_destination`, `untrusted_url`, `unsafe_name`, `size_mismatch`, `path_rejected`, `disk_full`, `busy`,
  `quota_exceeded`. No new runtime dependency. The plugin gets an optional `download_dir` setting (choosing it enables
  downloads) and the `download` skill uses the tool only on an explicit request. Distribution (npm, `.mcpb`,
  `server.json`) is a separate change. Review fixes: a child named `..x` is no longer taken for a parent in the deny-list,
  more system roots are denied, a failed write releases the response body, SIGTERM, SIGINT and SIGHUP remove the staging
  file before exiting, the copy fallback removes a partial final file, a link error other than the fallback codes is
  `path_rejected`, and the final mode is 0644 minus the umask.
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
