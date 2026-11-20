# Contract: Claude Code plugin packaging (`mothdex-mcp`)

Status: draft v1 (T-2 phase 2) · Owner: Alicerce · Implementers: Forja (T-33), Guindaste (T-34 release) · Risk: Medium (release workflow: High, T-34)
Sources: [T1c research](../../research/T1c-claude-code-plugin.md) (Claude Code 2.1.329, `--strict` validated layout), PLAN §3.2 and §9.

## 1. Decisions

- The repo is **both marketplace and plugin** (`source: "./"`). Users run `/plugin marketplace add Or4cu1o/mothdex-mcp`,
  then `/plugin install mothdex@mothdex-mcp`.
- The MCP server runs from a **committed, bundled** `dist/mothdex-mcp.mjs` (esbuild, no `node_modules`), built at release.
  Not `npx`, which would need network and npm at startup and adds supply-chain exposure (T1c option D).
- **`skills/` only.** `commands/` is legacy in Claude Code (PLAN §9). Plugin skills already appear as `/mothdex:<skill>`.
- **No `engines` field** (older clients reject manifests that have it) and no `userConfig` in v0.1 (there is no write tool yet).
- Deferred to **M3'** (E-M3'): `mcpb/manifest.json` (spec 0.3, node), `server.json` (registry, still preview), npm publish
  with provenance, `mcpName`. They reuse the same `dist/mothdex-mcp.mjs`.

## 2. Layout

```
mothdex-mcp/
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  .mcp.json
  dist/mothdex-mcp.mjs        # release artifact, committed; CI checks dist == build(src) (T-34)
  skills/mothdex/SKILL.md     # model-invoked: how to pick an entry and a link
  skills/search/SKILL.md      # user-invocable: /mothdex:search <query>
  skills/random/SKILL.md      # user-invocable: /mothdex:random [platform]
  skills/download/SKILL.md    # user-invocable: /mothdex:download <title|slug>; resolves links, prints the CLI command
  src/ …                      # server source (not referenced by the plugin manifest)
```

## 3. Files

`.claude-plugin/plugin.json`:

```json
{
  "name": "mothdex",
  "displayName": "Mothdex",
  "version": "0.1.0",
  "description": "Search the Mothdex game catalog and resolve download links",
  "author": { "name": "Or4cu1o" },
  "homepage": "https://github.com/Or4cu1o/mothdex-mcp",
  "repository": "https://github.com/Or4cu1o/mothdex-mcp",
  "license": "GPL-3.0-only",
  "keywords": ["mcp", "mothdex", "retro", "emulation"],
  "network": { "hosts": ["api.mothdex.net", "proxy.mothdex.net"] }
}
```

`.claude-plugin/marketplace.json`:

```json
{
  "name": "mothdex-mcp",
  "description": "Mothdex plugin for Claude Code",
  "owner": { "name": "Or4cu1o" },
  "plugins": [
    {
      "name": "mothdex",
      "source": "./",
      "description": "Search the Mothdex game catalog and resolve download links"
    }
  ]
}
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "mothdex": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mothdex-mcp.mjs"]
    }
  }
}
```

Rules:

- The entry `name` equals the manifest `name` (`mothdex`); names avoid the reserved prefixes (`claude-`, `anthropic-`, `cc-plugin-`).
- `license` is `GPL-3.0-only`, the same SPDX id as `package.json` in both repos (checked in the T-4 scaffold PR).
- `version` is bumped on **every** release (otherwise installed users stay pinned). One release script writes the same
  version into `package.json`, `plugin.json` and, from M3', `server.json` and the MCPB manifest. CI fails on a mismatch.
- `network.hosts` is informational only (not enforced). It lists the API host, and the proxy host that resolved links
  point to (the read-only server never calls the proxy; `download_file` will, from M3').
- Skills treat API text as data (tools.md §1); `skills/download` never downloads. It calls `resolve_download` and shows
  `mothdex download --slug <slug> --link <n>` for the CLI.

## 4. Validation

- CI (T-4/T-34): `claude plugin validate . --strict` (exit 0 required; warnings fail). Run it with a pinned Claude Code
  version installed in CI. `--profile directory` only if the plugin is ever submitted to Anthropic's directory.
- Smoke test: `node dist/mothdex-mcp.mjs` over stdio, then initialize → `tools/list` → one call (tools.md §6).
- Local install check before each release: `claude plugin marketplace add ./` plus `claude plugin install mothdex@mothdex-mcp`.

## 5. Future (M3', not in v0.1)

When `download_file` arrives (tools.md §3), add to `plugin.json`:

```json
"userConfig": { "download_dir": { "type": "directory", "title": "Download directory",
  "description": "The only folder where download_file may write", "required": false } }
```
and to `.mcp.json` `env`: `"MOTHDEX_DOWNLOAD_DIR": "${user_config.download_dir}"`, plus `"MOTHDEX_MCP_ENABLE_DOWNLOAD": "1"`
only when the user opts in. The runtime value of an unset optional `userConfig` is unverified (T1c), so the server must
treat an empty or literal `${…}` value as "not configured".

## Resolved questions (Regente, T-2 phase 2)

- OQ-PLG-1: moved to Risks & Backlog (check the plugin cache size with the first real `marketplace add` from git).
- OQ-PLG-2: yes. `network.hosts` declares `api.mothdex.net` and `proxy.mothdex.net` for transparency (Regente decision).
