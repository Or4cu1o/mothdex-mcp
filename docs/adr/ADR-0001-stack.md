# ADR-0001: Go for `mothdex-cli`, TypeScript for `mothdex-mcp`

Status: **Accepted** (owner decision D1, 2026-11-20) · Author: Alicerce · Context: [PLAN v0](../README.md#planning-references) §2.1, §3.1

## Context

The legacy `CLIDOWNROM` is ~9.5k lines of Python with four UIs. The new CLI must run on emulation distros
(Batocera, Recalbox, EmuELEC, Lakka, RetroBat) that have no pip, a read-only rootfs and armv7/arm64 CPUs, and it
should ship through GitHub Releases, `install.sh` and later WinGet/Scoop/Homebrew/AUR/deb/rpm. The MCP server must
install easily in Claude Desktop, Claude Code (plugin), Cursor and other agents.

## Options

|                                        | Go                              | Python (legacy)           | Rust            | TypeScript                                   |
| -------------------------------------- | ------------------------------- | ------------------------- | --------------- | -------------------------------------------- |
| Static binary with no runtime          | yes (`CGO_ENABLED=0`)           | no (PyInstaller per arch) | yes             | no                                           |
| Cross-compiling to armv7/arm64/Windows | trivial                         | hard                      | good (cross-rs) | n/a                                          |
| Packaging for every channel            | GoReleaser does all of it       | manual                    | partial         | npm only                                     |
| CLI/TUI ecosystem                      | Cobra, Bubble Tea               | click, Textual            | clap, ratatui   | ink                                          |
| MCP distribution                       | binary per OS inside the plugin | —                         | same as Go      | `npx`, `.mcpb` with bundled Node, one `.mjs` |
| Contributor ramp-up                    | low                             | low                       | high            | low                                          |

## Decision

- **`mothdex-cli` in Go**: one static binary per OS and architecture; the GUI (SDL2, cgo) is a separate binary, so
  the main one stays static (PLAN §2.1).
- **`mothdex-mcp` in TypeScript** with the official MCP SDK over stdio, shipped as a single esbuild bundle.

## Consequences

- The API client exists twice (Go `pkg/mothdex`, TS client). Drift is controlled by **one** contract
  ([`api-client.md`](https://github.com/Or4cu1o/mothdex-cli/blob/main/docs/contracts/cli/api-client.md) in mothdex-cli) and **one** fixture set owned by the CLI repo, copied into the MCP repo with a CI
  divergence check. The client covers only 6 endpoints, so duplication costs less than shipping per-platform Go
  binaries inside the plugin.
- Error codes and link ranking rules are shared by contract and ported, not imported.
- Two toolchains in CI (golangci-lint/govulncheck and biome/tsc/npm audit).
- Reversal cost: high for the CLI (a full rewrite), low for the MCP (small server).
