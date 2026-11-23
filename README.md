# mothdex-mcp

[![CI](https://github.com/Or4cu1o/mothdex-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Or4cu1o/mothdex-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Or4cu1o/mothdex-mcp?include_prereleases)](https://github.com/Or4cu1o/mothdex-mcp/releases)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933)](package.json)

[Model Context Protocol](https://modelcontextprotocol.io) server for the
[Mothdex](https://api.mothdex.net) API.

> **Status: v0.1.0.** First release: the stdio server, its read tools, resources and prompts work against the live API.
> It is published on npm, in the MCP registry, as a Claude Code plugin and as a Claude Desktop `.mcpb`.

## Install

- **npm:** `npx -y mothdex-mcp` (Node 22 or later), or configure your client with command `npx` and args `["-y", "mothdex-mcp"]`.
- **MCP registry:** `io.github.Or4cu1o/mothdex-mcp`.
- **Claude Desktop:** download `mothdex-mcp_0.1.0.mcpb` from the [latest release](https://github.com/Or4cu1o/mothdex-mcp/releases/latest)
  and open it. The release also has `checksums.txt` and build provenance (`gh attestation verify`).
- **Claude Code plugin:** see [Install in Claude Code](#install-in-claude-code).

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

## Done and planned

- [ ] Opt-in, directory-confined file download tool (off by default)
- [x] Single-file bundle without runtime dependencies, attached to each release with checksums and provenance

## Downloads (opt-in)

`download_file` is off unless you turn it on. It writes one file per call into **one folder you choose** and nowhere
else. Set both variables (the plugin and the `.mcpb` set the first for you; choosing the folder is the opt-in):

- `MOTHDEX_MCP_ENABLE_DOWNLOAD=1` (exactly `1`);
- `MOTHDEX_DOWNLOAD_DIR=/absolute/path/to/an/existing/folder`.

The folder must exist and must not be a filesystem root, your home folder, a protected folder (`~/.ssh`, `~/.config`,
`~/.claude`, ...), a launcher folder (`ports`, `ports_scripts`, `windows`), a Git working tree, a system folder (`/etc`, `/var` on Linux,
`/opt`, `/proc`, `/run/user`, Program Files, ...; removable drives under `/run/media` are fine) or a world-writable folder. Optional caps: `MOTHDEX_DOWNLOAD_MAX_FILE_BYTES` and `MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES` (default 64 GiB each).
Only `proxy.mothdex.net` links are fetched, one download runs at a time, at most 20 complete per server run, a file is
never overwritten (`status: "exists"`) and executable extensions are refused. Integrity is the SHA-256 of what was
written, not proof that the file is genuine.

**Do not choose "always allow" for this tool**: catalog text is untrusted and could try to make the model call it. The
tool's annotations tell clients that honor them to ask before each call. A project-scope `.mcp.json` can run any command, so the client's approval of
that file is the real boundary (see [SECURITY.md](SECURITY.md)). The design is in
[docs/security/T-60-threat-model-download-file.md](docs/security/T-60-threat-model-download-file.md).

## Install in Claude Code

The marketplace entry is pinned to the release tag and commit, so you install exactly the attested release
([docs/release.md](docs/release.md)):

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

## Report a problem or an idea

- [Report a bug](https://github.com/Or4cu1o/mothdex-mcp/issues/new?template=bug_report.yml)
- [Suggest a feature](https://github.com/Or4cu1o/mothdex-mcp/issues/new?template=feature_request.yml)
- Testing Mothdex on a handheld or a retro-gaming system? See the
  [beta testing guide](https://github.com/Or4cu1o/mothdex-cli/blob/main/docs/beta-testing.md) and the
  [device report form](https://github.com/Or4cu1o/mothdex-cli/issues/new?template=device_report.yml).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
Project history is in [CHANGELOG.md](CHANGELOG.md).

## License

[GPL-3.0](LICENSE)
