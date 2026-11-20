# mothdex-mcp

[![CI](https://github.com/Or4cu1o/mothdex-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Or4cu1o/mothdex-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Or4cu1o/mothdex-mcp?include_prereleases)](https://github.com/Or4cu1o/mothdex-mcp/releases)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933)](package.json)

[Model Context Protocol](https://modelcontextprotocol.io) server for the
[Mothdex](https://api.mothdex.net) API.

> **Status: pre-alpha.** Only the project skeleton exists. The bundle prints its
> version and nothing else. Everything listed below is **planned**, not
> implemented.

## Planned features

- [ ] Read tools: search, entry details, random pick, platforms, regions, database info, download link resolution
- [ ] MCP resources and prompts
- [ ] Opt-in, directory-confined file download tool (off by default)
- [ ] Claude Code plugin and marketplace
- [ ] Claude Desktop `.mcpb` package and MCP registry entry
- [ ] Single-file bundle without runtime dependencies

## Develop

Requires Node (see `.node-version`) and [pnpm](https://pnpm.io) (version pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/mothdex-mcp.mjs
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
Project history is in [CHANGELOG.md](CHANGELOG.md).

## License

[GPL-3.0](LICENSE)
