# Contract: Claude Code plugin packaging (`mothdex-mcp`)

Status: draft v1 (T-2 phase 2) · Owner: Alicerce · Implementers: Forja (T-33), Guindaste (T-34 release) · Risk: Medium (release workflow: High, T-34)
Sources: [T1c research](../../research/T1c-claude-code-plugin.md) (Claude Code 2.1.329, `--strict` validated layout), PLAN §3.2 and §9.

## 1. Decisions

- The repo is **both marketplace and plugin**. The marketplace entry has two states: before the first release it is
  `source: "./"` (the plugin is the checkout, so it follows `main` HEAD); from the first release it is pinned to a
  release, `source: { "source": "github", "repo": "Or4cu1o/mothdex-mcp", "ref": "vX.Y.Z", "sha": "<tag commit>" }`
  ([docs/release.md](../../release.md) step 3). Users run `/plugin marketplace add Or4cu1o/mothdex-mcp`, then
  `/plugin install mothdex@mothdex-mcp`; once pinned they get exactly the attested tag, not `main`.
- The MCP server runs from a **committed, bundled** `dist/mothdex-mcp.mjs` (esbuild, no `node_modules`), built at release.
  Not `npx`, which would need network and npm at startup and adds supply-chain exposure (T1c option D).
- **`skills/` only.** `commands/` is legacy in Claude Code (PLAN §9). Plugin skills already appear as `/mothdex:<skill>`.
- **No `engines` field** (older clients reject manifests that have it) and no `userConfig` in v0.1 (there is no write tool yet).
- **v0.2 (E-M3', §5):** `mcpb/manifest.json` (spec 0.3, node), `server.json` (registry, still preview), npm publish
  with trusted publishing and provenance, `mcpName`. They reuse the same `dist/mothdex-mcp.mjs`.

## 2. Layout

```
mothdex-mcp/
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  .mcp.json
  dist/mothdex-mcp.mjs        # release artifact, committed; CI checks dist == build(src) (T-34)
                              # marketplace.json: source "./" before the first release, github ref+sha after (§1)
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
- **Since T-34** `dist/mothdex-mcp.mjs` is committed and both versions are `0.1.0` before the first tag. CI fails when
  the committed bundle differs from the build of `src`. The release workflow, the verification commands and the step that
  pins the marketplace `source` to the tag and commit are in [docs/release.md](../../release.md).
- `network.hosts` is informational only (not enforced). It lists the API host, and the proxy host that resolved links
  point to (the read-only server never calls the proxy; `download_file` will, from M3').
- Skills treat API text as data (tools.md §1); `skills/download` never downloads. It calls `resolve_download` and shows
  `mothdex download --slug <slug> --link <n>` for the CLI.

## 4. Validation

- CI (T-4/T-34): `claude plugin validate . --strict` (exit 0 required; warnings fail). Run it with a pinned Claude Code
  version installed in CI. `--profile directory` only if the plugin is ever submitted to Anthropic's directory.
- Smoke test: `node dist/mothdex-mcp.mjs` over stdio, then initialize → `tools/list` → one call (tools.md §6).
- Local check before each release, against the **working tree** (after the pin the marketplace entry points at a past
  tag, so `marketplace add ./` would test that tag, not your changes): `claude --plugin-dir .`, or a scratch
  marketplace outside `.claude-plugin/` whose entry has `source: "./"`.

## 5. v0.2.0: download opt-in and distribution (E-M3', T-61)

Contract v1 · Risk **High** (supply chain). Threat model [T-60](../../security/T-60-threat-model-download-file.md) §4.7.
Implementers:

- Bigorna for `plugin.json`, `.mcp.json`, `mcpb/manifest.json`, `server.json` and `package.json`;
- Guindaste for `release.yml` and `docs/release.md`.

Sentinela re-audits the new release steps on their final commit (CR-18).

### 5.1 Opt-in in the plugin and the `.mcpb` (CR-1, CR-16; MT-02, SC-05)

In the packaged forms, **choosing the download folder is the opt-in**.

- The enable flag is set statically to `"1"`.
- The folder setting is optional and has **no default**.
- An unset value reaches the server as empty or as a literal `${...}`. That is "not configured" (tools.md §3.2), so the tool stays unregistered.

This replaces the v0.1 sketch's "`1` only when the user opts in" because:

- a plugin cannot set an env var conditionally;
- the mcpb boolean substitution is Unverified (SC-05);
- one explicit act (picking a folder whose description says it enables writes) is the consent.

Sentinela confirmed this mapping (T-61). **Unverified:** how Claude Code treats an unresolved `user_config` placeholder.
If the client refuses to start the server, the read tools go down too. Bigorna checks this once with a real plugin
install and records the result in the implementation PR.

`plugin.json`:

```json
"userConfig": { "download_dir": { "type": "directory", "title": "Download folder (enables downloads)",
  "description": "Setting this enables the download_file tool, which writes only into this folder. Leave empty to keep the plugin read-only.",
  "required": false } }
```

`.mcp.json`, server `mothdex`:

```json
"env": { "MOTHDEX_MCP_ENABLE_DOWNLOAD": "1", "MOTHDEX_DOWNLOAD_DIR": "${user_config.download_dir}" }
```

`mcpb/manifest.json` (spec 0.3, `server.type: "node"`, entry `dist/mothdex-mcp.mjs`) uses the same shape:

- `user_config.download_dir`: `type: "directory"`, `required: false`, no `default` (never `${HOME}` or `${DOWNLOADS}`).
- `mcp_config.env`: `MOTHDEX_MCP_ENABLE_DOWNLOAD: "1"`, `MOTHDEX_DOWNLOAD_DIR: "${user_config.download_dir}"`.
- No other env, no `${HOME}`-based defaults.

For a manual `claude mcp add` or another client, the user sets both variables. The README documents that, plus the residual risk: a project-scope `.mcp.json` can run any command, and the client's approval is the boundary (SECURITY.md, MT-01).

### 5.2 npm package (CR-15; SC-02, SC-03)

**Name.** `<npm-name>` is **owner decision OD-3**: `mothdex-mcp` or `@or4cu1o/mothdex-mcp`. Until it is decided, every file below uses that placeholder, and the release PR fills it.

`package.json` in the release PR:

- `private: false`, `name: "<npm-name>"`, `mcpName: "io.github.Or4cu1o/mothdex-mcp"`;
- `bin: {"mothdex-mcp": "dist/mothdex-mcp.mjs"}`;
- `files: ["dist/mothdex-mcp.mjs", "README.md", "LICENSE"]`.

**No runtime `dependencies`:** the bundle is self-contained, so `@modelcontextprotocol/server` and `zod` move to `devDependencies`.

**No lifecycle scripts** (`preinstall`, `install`, `postinstall`, `prepare`, `prepublish*`, `prepack`, `postpack`).

**CI check** (every PR and release):

1. `npm pack --dry-run --json` lists exactly the three files, plus `package.json`.
2. The packed `dist/mothdex-mcp.mjs` SHA-256 equals the committed, attested asset.
3. `package.json` has no `dependencies` and no lifecycle script.

### 5.3 Release order and steps (CR-14, CR-16, CR-17; SC-01, SC-04, SC-06, SC-08)

All new steps run in the existing `publish` job, or in a later job that needs it, inside environment `release`:

- GitHub-hosted runner;
- actions pinned by SHA;
- the tag only via `env`;
- the existing tag-peel check (`GITHUB_SHA`) before anything is published.

The order is fixed, and each step verifies the previous one's hash:

1. **`build`:**
   - the bundle, as today;
   - the `.mcpb` packed from the committed dist with a pinned `@anthropic-ai/mcpb`: exact version, installed with `--ignore-scripts`, never `npx` latest;
   - `unzip -l` must list exactly `manifest.json`, `dist/mothdex-mcp.mjs` and the icon;
   - `mcpb validate` passes;
   - the `.mcpb` goes into `checksums.txt`.
2. **`attest`:** provenance for the `.mjs`, the `.mcpb` and `checksums.txt`.
3. **GitHub release:** assets plus attestations, as today.
4. **npm, trusted publishing (OIDC):**
   - `id-token: write` on this job only, npm ≥ 11.5.1, Node ≥ 22.14.0 (F10);
   - `npm publish` of the verified tarball; provenance is automatic;
   - **no `NPM_TOKEN` or any long-lived npm secret** in the repo or org;
   - afterwards, `npm view <npm-name>@<version> dist.integrity` and `npm audit signatures`.
5. **Registry:** `server.json` published with a pinned `mcp-publisher` whose Sigstore bundle is verified before use, after `mcp-publisher login github-oidc`.
6. **Marketplace pin PR** (§1, docs/release.md step 3).

`.mcpb` signing:

- optional;
- never self-signed in a release;
- if signed, the certificate and key live only in environment `release`;
- docs never claim signature protection (F11).

`server.json`:

- `name: "io.github.Or4cu1o/mothdex-mcp"`, equal to `package.json` `mcpName` (CI check);
- `version` equals the tag;
- `packages`: the npm package with the exact version, and the mcpb with a URL under `https://github.com/Or4cu1o/mothdex-mcp/releases/download/<tag>/` plus `fileSha256`;
- `environmentVariables`: `MOTHDEX_MCP_ENABLE_DOWNLOAD` (not secret, described as "set to 1 to enable download_file"; no default) and `MOTHDEX_DOWNLOAD_DIR` (no default).

The registry is in preview, so the entry is re-checked after a data reset.

**Owner steps** (Guindaste writes them into docs/release.md, CR-14):

1. Decide OD-3.
2. Create the package and configure the trusted publisher (repo, `release.yml`, environment `release`). If the package has to exist first (Unverified), do the first publish locally with 2FA, or with a granular token scoped to that one package, read/write, shortest expiry, deleted right after use.
3. Set "Require two-factor authentication and disallow tokens".
4. Confirm that `io.github.Or4cu1o` namespace auth works from the workflow.

### 5.4 Tests

T-60 §6 cases 40-44 are CI checks in the release PR; no real publish happens in tests. A case that CI cannot run end to end (43 with the packed bundle in a real client) is marked not verified in the PR.

## Resolved questions (Regente, T-2 phase 2)

- OQ-PLG-1: moved to Risks & Backlog (check the plugin cache size with the first real `marketplace add` from git).
- OQ-PLG-2: yes. `network.hosts` declares `api.mothdex.net` and `proxy.mothdex.net` for transparency (Regente decision).
