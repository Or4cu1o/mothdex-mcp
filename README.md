# mothdex-mcp

[![CI](https://github.com/Or4cu1o/mothdex-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Or4cu1o/mothdex-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Or4cu1o/mothdex-mcp?include_prereleases)](https://github.com/Or4cu1o/mothdex-mcp/releases)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933)](package.json)

[Model Context Protocol](https://modelcontextprotocol.io) server for the
[Mothdex](https://api.mothdex.net) API.

> **Status: pre-alpha.** The stdio server, its read tools, resources and prompts work against the live API
> but nothing is released yet. The Claude Code plugin, the `.mcpb` package and the registry entry are still planned.

## What it offers

- Tools (read-only): `search_entries`, `get_entry`, `random_entry`, `list_platforms`, `list_regions`, `db_info`,
  `resolve_download`. Outputs are compact JSON (`structuredContent` plus the same JSON as text).
  `search_entries` needs at least one filter. `resolve_download` returns links and flags hosts outside the
  allowlist; it downloads nothing.
- Resources: `mothdex://platforms`, `mothdex://regions`, `mothdex://entry/{slug}`.
- Prompts: `find_best_version`, `build_collection`.
- Text that comes from the database is untrusted data; the tool and prompt texts tell the model so.

Configuration is environment only: `MOTHDEX_API_BASE_URL` (default `https://api.mothdex.net/v1`),
`MOTHDEX_API_RATE_LIMIT` (requests per second, clamped to 1..10, default 5) and `MOTHDEX_ALLOWED_HOSTS`
(comma list, default `proxy.mothdex.net`). Logs go to stderr; stdout carries only the protocol.

## Planned

- [ ] Opt-in, directory-confined file download tool (off by default)
- [ ] Claude Code plugin and marketplace
- [ ] Claude Desktop `.mcpb` package and MCP registry entry
- [ ] Single-file bundle without runtime dependencies

## Install in Claude Code

The plugin installs from the first release (T-34). Until then a git install has no `dist/mothdex-mcp.mjs`, so the
server would not start. Once released:

```text
/plugin marketplace add Or4cu1o/mothdex-mcp
/plugin install mothdex@mothdex-mcp
```

It runs the bundled `dist/mothdex-mcp.mjs` with `node` from your PATH (Node 22 or later) and adds the skills `/mothdex:search`, `/mothdex:random` and
`/mothdex:download`.

To try it locally, clone the repository, run `pnpm install --frozen-lockfile` and `pnpm build`, then, inside Claude Code,
`/plugin marketplace add ./` and `/plugin install mothdex@mothdex-mcp`.

## Develop

Requires Node (see `.node-version`) and [pnpm](https://pnpm.io) (version pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/mothdex-mcp.mjs   # speaks MCP on stdin/stdout; --version prints the version
```

`src/api/` holds the API v1 client. Its test fixtures are a copy of the ones in
[mothdex-cli](https://github.com/Or4cu1o/mothdex-cli); `pnpm check:fixtures` (and CI) fails when they diverge, and
`node scripts/check-fixtures.mjs --update` refreshes the copy.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
Project history is in [CHANGELOG.md](CHANGELOG.md).

## License

[GPL-3.0](LICENSE)
