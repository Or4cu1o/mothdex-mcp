# T1d - MCP TypeScript SDK, MCPB, official registry, npm provenance

Ref: T1d. Date checked: 2026-11-20. Analyst: Sonda.
Supports: PLAN-v0.md section 3.1 (TypeScript, `@modelcontextprotocol/sdk`, stdio), 3.2 (`mcpb/manifest.json`, `server.json`).

## Question

Which SDK package/version should mothdex-mcp use, what are the stdio server API, MCPB manifest, registry `server.json` and publish flow, and npm provenance requirements?

## Short answer

- PLAN CORRECTION: `@modelcontextprotocol/sdk` is now the v1 line (latest 1.32.2, 2026-10-23, Node >=18). **v2 is stable since 2026-07-27** and is split into `@modelcontextprotocol/server` (+ `client`, `core`, adapters), latest 2.4.0 (2026-10-23), Node >=20, zod >=4.2 required. v1.x gets bug/security fixes "at least six months after" 2026-07-27 (to about 2027-01-27).
- Recommendation: start on v2 (`@modelcontextprotocol/server`), since a new project would otherwise face a forced migration within ~2 months. v2 negotiates protocol versions 2025-11-25 and 2026-07-28 (Inferred from dist code), so older Claude clients should still connect; client-compat is not tested.
- Roots/sampling/logging are deprecated (SEP-2577) but still work in v2; Claude Code still answers `roots/list`.
- MCPB: spec `manifest_version` current is `"0.3"` (schema `latest` const 0.3; a v0.4 schema file exists, used for `uv` servers). CLI `@anthropic-ai/mcpb` 2.1.2: `init`, `validate`, `pack`, `sign`, `verify`, `info`, `unsign`.
- Registry: still **preview** per its docs (API freeze v0.1 announced 2025-10-24; GA not announced in docs I read). Latest published schema URL `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`. `mcp-publisher` latest release v1.8.10 (2026-11-20).
- Name `io.github.<owner>/<name>` requires GitHub auth; npm ownership proven by `mcpName` in package.json equal to server.json `name`. Org namespace (`io.github.<org>`) cannot use interactive `login github` today; use GitHub Actions OIDC or a PAT with org read.
- npm provenance: GitHub-hosted runner, `id-token: write`, npm >= 9.5.0, matching public `repository`, `npm publish --provenance --access public`; npm trusted publishing (OIDC) generates provenance automatically.

## Evidence

| #   | Claim                                                                                                                                                                                                                                                                                                                                                                     | Label                          | Source                                                                                                                                        | Version                                                 | Checked    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| 1   | `@modelcontextprotocol/sdk` latest = 1.32.2, published 2026-10-23, engines node >=18, deps zod ^3.25 or ^4                                                                                                                                                                                                                                                                | Confirmed                      | `npm view @modelcontextprotocol/sdk` (registry.npmjs.org)                                                                                     | 1.32.2                                                  | 2026-11-20 |
| 2   | `@modelcontextprotocol/server` and `/client` latest = 2.4.0 (2026-10-23), engines node >=20; server deps zod ^4.2.0, `@modelcontextprotocol/core` 2.4.0; 2.0.0 released 2026-07-27                                                                                                                                                                                        | Confirmed                      | npm view `@modelcontextprotocol/server`, `/client`                                                                                            | 2.4.0                                                   | 2026-11-20 |
| 3   | `main` branch = v2 "the stable release line" implementing spec 2026-07-28; v1.x branch gets fixes for at least six months after 2026-07-27; runs on Node, Bun, Deno                                                                                                                                                                                                       | Confirmed                      | https://github.com/modelcontextprotocol/typescript-sdk README                                                                                 | main                                                    | 2026-11-20 |
| 4   | v2 split: `server`, `client`, `core`, adapters `node`, `express`, `hono`, `fastify`; ESM-first plus CJS build; Node 20+; Zod >= 4.2.0 (Zod v3 unsupported)                                                                                                                                                                                                                | Confirmed                      | https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2 ; package.json exports of 2.4.0 tarball                                     | 2.4.0                                                   | 2026-11-20 |
| 5   | v2 stdio import: `StdioServerTransport` from `@modelcontextprotocol/server/stdio` (not package root); `serveStdio` helper also in `/stdio`; both present in 2.4.0 typings                                                                                                                                                                                                 | Confirmed                      | migration guide; `npm pack` of 2.4.0, `dist/stdio.d.mts`                                                                                      | 2.4.0                                                   | 2026-11-20 |
| 6   | v2 registration: variadic `.tool/.prompt/.resource` removed; use `registerTool(name,{description,inputSchema: z.object(...)},cb)`, `registerPrompt`, `registerResource` (metadata arg required, `{}` if none); raw zod shapes work via deprecated overloads; `structuredContent` typed against `outputSchema`                                                             | Confirmed                      | migration guide                                                                                                                               | 2.4.0                                                   | 2026-11-20 |
| 7   | v2 docs example uses `serveStdio(() => { const server = new McpServer({name,version}); server.registerTool(...); return server; })` with `import * as z from 'zod/v4'`                                                                                                                                                                                                    | Confirmed                      | https://ts.sdk.modelcontextprotocol.io/v2/                                                                                                    | 2.x                                                     | 2026-11-20 |
| 8   | v1 1.32.2 still has `registerTool/registerResource/registerPrompt`, `.tool/.resource/.prompt` marked deprecated, `Server.listRoots()`, ESM package (`"type":"module"`), `StdioServerTransport` at `@modelcontextprotocol/sdk/server/stdio.js`                                                                                                                             | Confirmed                      | `npm pack @modelcontextprotocol/sdk@1.32.2` typings                                                                                           | 1.32.2                                                  | 2026-11-20 |
| 9   | v2 `SUPPORTED_PROTOCOL_VERSIONS` includes 2025-11-25 and 2026-07-28                                                                                                                                                                                                                                                                                                       | Inferred                       | grep of 2.4.0 dist (full list not read)                                                                                                       | 2.4.0                                                   | 2026-11-20 |
| 10  | Roots, sampling, logging deprecated under SEP-2577 as of protocol 2026-07-28; still work; v2 server `listRoots()` exists; docs sidebar "Roots (sunset)"                                                                                                                                                                                                                   | Confirmed                      | migration guide; 2.4.0 typings comment                                                                                                        | 2.4.0                                                   | 2026-11-20 |
| 11  | Claude Code answers `roots/list` (launch dir + added dirs) and emits `roots/list_changed`                                                                                                                                                                                                                                                                                 | Confirmed                      | https://code.claude.com/docs/en/mcp                                                                                                           | CC 2.1.329 docs                                         | 2026-11-20 |
| 12  | Claude Desktop answers roots                                                                                                                                                                                                                                                                                                                                              | Unverified                     | not checked                                                                                                                                   | -                                                       | 2026-11-20 |
| 13  | MCPB manifest: required `manifest_version`,`name`,`version`(semver),`description`,`author{name}`,`server`; optional display_name, long_description, keywords, license, repository, homepage, documentation, support, privacy_policies, icon(s), screenshots, tools, prompts (+`_generated`), compatibility, user_config, localization, `_meta`                            | Confirmed                      | https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md                                                                            | spec 0.3                                                | 2026-11-20 |
| 14  | `manifest_version` current `"0.3"` (MANIFEST.md "Current version: 0.3"; `mcpb-manifest-latest.schema.json` const "0.3"); a `v0.4` schema exists and MANIFEST.md says `uv` server type needs 0.4                                                                                                                                                                           | Confirmed                      | MANIFEST.md; repo `schemas/`                                                                                                                  | main (last commit 2026-04-22)                           | 2026-11-20 |
| 15  | `server.type` in node/python/binary/uv; `entry_point`; `mcp_config{command,args,env,platform_overrides}`; `${__dirname}` = extension install dir; also `${HOME}`,`${DESKTOP}`,`${DOCUMENTS}`,`${DOWNLOADS}`,`${/}`; `${user_config.KEY}` substitution                                                                                                                     | Confirmed                      | MANIFEST.md                                                                                                                                   | 0.3                                                     | 2026-11-20 |
| 16  | `user_config` fields: type (string/number/boolean/directory/file), title, description, required, default, multiple, sensitive, min/max; `compatibility`: claude_desktop semver, platforms (darwin/win32/linux), runtimes.node                                                                                                                                             | Confirmed                      | MANIFEST.md                                                                                                                                   | 0.3                                                     | 2026-11-20 |
| 17  | CLI: `npm i -g @anthropic-ai/mcpb`; `mcpb init [dir]`, `mcpb validate <path>`, `mcpb pack <dir> [output]`, `sign <file> [--cert --key --intermediate --self-signed]`, `verify`, `info`, `unsign`                                                                                                                                                                          | Confirmed                      | https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md                                                                                 | npm 2.1.2 (2025-12-04 release; npm modified 2026-10-07) | 2026-11-20 |
| 18  | Opening a `.mcpb` in Claude Desktop (macOS/Windows) shows an install dialog, with auto-update and variable config                                                                                                                                                                                                                                                         | Confirmed                      | mcpb README                                                                                                                                   | main                                                    | 2026-11-20 |
| 19  | server.json: `$schema` `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`; fields name, title, description (max 100 chars in official registry), version, repository{url,source,subfolder,id}, websiteUrl, packages[], remotes[], `_meta`                                                                                                     | Confirmed                      | registry repo `docs/reference/server-json/generic-server-json.md`, `CHANGELOG.md` (latest dated 2025-12-11; Draft unreleased), quickstart.mdx | schema 2025-12-11                                       | 2026-11-20 |
| 20  | npm package entry: `registryType:"npm"`, `identifier`, `version`, `transport:{type:"stdio"}`, optional `registryBaseUrl` (only `https://registry.npmjs.org`), `runtimeHint`, `environmentVariables`, `packageArguments`                                                                                                                                                   | Confirmed                      | generic-server-json.md; official-registry-requirements.md                                                                                     | 2025-12-11                                              | 2026-11-20 |
| 21  | mcpb package entry: `registryType:"mcpb"`, `identifier` = https URL of the `.mcpb` on GitHub/GitLab Releases, `fileSha256`, `transport`; URL must contain "mcp"; registry does not check the hash, clients do                                                                                                                                                             | Confirmed                      | package-types.mdx; official-registry-requirements.md                                                                                          | 2025-12-11                                              | 2026-11-20 |
| 22  | npm ownership: `mcpName` in package.json must equal server.json `name`                                                                                                                                                                                                                                                                                                    | Confirmed                      | package-types.mdx                                                                                                                             | -                                                       | 2026-11-20 |
| 23  | Name namespace: GitHub auth => `io.github.username/*` or `io.github.orgname/*`; domain auth => reverse-DNS `com.example.*/*`                                                                                                                                                                                                                                              | Confirmed                      | https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx                                    | -                                                       | 2026-11-20 |
| 24  | Auth methods: `mcp-publisher login github` (device flow), `login github --token` (PAT), `login github-oidc` (Actions), DNS (TXT on apex, Ed25519/ECDSA P-384, also Google KMS/Azure Key Vault), HTTP also exists (not read)                                                                                                                                               | Confirmed (HTTP: Unverified)   | authentication.mdx, github-actions.mdx                                                                                                        | -                                                       | 2026-11-20 |
| 25  | `login github` cannot publish to org namespaces (GitHub App token cannot read org membership; tracking issue #1468); org requires Owner role; use Actions OIDC or PAT with `read:org` / fine-grained Members read                                                                                                                                                         | Confirmed                      | authentication.mdx                                                                                                                            | -                                                       | 2026-11-20 |
| 26  | Publishing steps: add `mcpName`; `npm publish --access public`; `mcp-publisher init` / `login` / `publish`; commands: init, login, logout, publish, status, validate; install by binary or `brew install mcp-publisher`                                                                                                                                                   | Confirmed                      | quickstart.mdx                                                                                                                                | mcp-publisher 1.8.10 (release 2026-11-20)               | 2026-11-20 |
| 27  | Registry is "currently in preview; breaking changes or data resets may occur before GA"; API freeze v0.1 announced 2025-10-24                                                                                                                                                                                                                                             | Confirmed (as of docs on main) | authentication.mdx, github-actions.mdx, registry README                                                                                       | main                                                    | 2026-11-20 |
| 28  | CI example: OIDC login needs `permissions: id-token: write`; pins `MCP_PUBLISHER_VERSION` (v1.8.1 in docs) and verifies Sigstore bundle with cosign before running                                                                                                                                                                                                        | Confirmed                      | github-actions.mdx                                                                                                                            | -                                                       | 2026-11-20 |
| 29  | npm provenance: cloud CI (GitHub Actions/GitLab), npm >= 9.5.0, `repository` field public and matching (case-sensitive), `--provenance` flag (or `publishConfig.provenance`, `NPM_CONFIG_PROVENANCE`), `--access public` on first publish; Actions needs `id-token: write` + GitHub-hosted runner; trusted publishing (OIDC) auto-generates provenance and removes tokens | Confirmed                      | https://docs.npmjs.com/generating-provenance-statements                                                                                       | npm docs                                                | 2026-11-20 |
| 30  | Registry GA status / date                                                                                                                                                                                                                                                                                                                                                 | Unverified                     | no GA announcement found in repo docs                                                                                                         | -                                                       | 2026-11-20 |

## Minimal examples

v2 stdio server (from official docs, Confirmed), adding resource/prompt shape per migration guide (Inferred, not executed):

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

serveStdio(() => {
  const server = new McpServer({ name: "mothdex", version: "0.1.0" });
  server.registerTool(
    "search_entries",
    { description: "Search entries", inputSchema: z.object({ q: z.string() }) },
    async ({ q }) => ({ content: [{ type: "text", text: `...${q}` }] }),
  );
  // registerResource(name, uriOrTemplate, metadata /* {} if none */, readCallback)
  return server;
});
```
(`StdioServerTransport` + `server.connect(transport)` remains available from `/stdio` for explicit wiring.)

MCPB `manifest.json` (spec 0.3, adapted from MANIFEST.md minimal example, not run through `mcpb validate`):

```json
{
  "manifest_version": "0.3",
  "name": "mothdex",
  "version": "0.1.0",
  "description": "Search and resolve downloads from the Mothdex catalog",
  "author": { "name": "Example Owner" },
  "server": {
    "type": "node",
    "entry_point": "dist/mothdex-mcp.mjs",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/mothdex-mcp.mjs"],
      "env": { "MOTHDEX_DOWNLOAD_DIR": "${user_config.download_dir}" }
    }
  },
  "user_config": {
    "download_dir": {
      "type": "directory",
      "title": "Download directory",
      "description": "Where download_file may write",
      "required": false
    }
  },
  "compatibility": { "platforms": ["darwin", "win32", "linux"], "runtimes": { "node": ">=20" } }
}
```
`server.json` + `package.json`:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.OWNER/mothdex-mcp",
  "description": "Search and resolve downloads from the Mothdex catalog",
  "version": "0.1.0",
  "repository": { "url": "https://github.com/OWNER/mothdex-mcp", "source": "github" },
  "packages": [
    {
      "registryType": "npm",
      "identifier": "mothdex-mcp",
      "version": "0.1.0",
      "transport": { "type": "stdio" }
    }
  ]
}
```
`package.json` must carry `"mcpName": "io.github.OWNER/mothdex-mcp"`. For MCPB add a second package `{ "registryType":"mcpb", "identifier":"https://github.com/OWNER/mothdex-mcp/releases/download/v0.1.0/mothdex.mcpb", "fileSha256":"<sha256>", "transport":{"type":"stdio"} }`.

## Options compared

| Option                                     | Pros                                                                        | Cons                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. v2 `@modelcontextprotocol/server` 2.4.0 | Stable line, latest spec, long support; Node >=20 fits bundle/MCPB; ESM+CJS | Newer API (`/stdio` import, Standard Schema), fewer community examples; zod >=4.2 only; roots deprecated; client interop with older Desktop untested |
| 2. v1 `@modelcontextprotocol/sdk` 1.32.2   | Widest examples; Node >=18; roots non-deprecated API; plan text matches     | Maintenance-only, support window ends about 2027-01-27 (six months after 2026-07-27, "at least"); migration later                                    |
| 3. Both (thin adapter)                     | -                                                                           | YAGNI; double testing                                                                                                                                |

| Publish channel                      | Auth                                                   | Notes                                         |
| ------------------------------------ | ------------------------------------------------------ | --------------------------------------------- |
| Registry via npm package             | GitHub (personal `io.github.<user>`) or OIDC/PAT (org) | needs npm publish first; `mcpName`            |
| Registry via mcpb on GitHub Releases | same                                                   | URL must contain "mcp"; `fileSha256` required |
| DNS namespace `com.example/*`        | TXT record on apex                                     | needs owned domain; not needed for v0         |

## Recommendation

1. Use v2 `@modelcontextprotocol/server` 2.4.0 with zod >= 4.2, Node >= 20 (set `engines.node >=20`, MCPB `runtimes.node >=20`). Fall back to v1 1.32.2 only if a target client fails to negotiate (test with Claude Desktop, Claude Code, Cursor before release). Update PLAN-v0.md 3.1 accordingly.
2. Bundle with esbuild to a single `dist/mothdex-mcp.mjs` for plugin and MCPB (same artifact).
3. Registry: publish npm package with provenance first, then `server.json` via GitHub Actions OIDC (works for user and org namespaces). Pin `mcp-publisher` version and verify its Sigstore bundle as in the official workflow. Namespace `io.github.<owner-or-org>/mothdex-mcp` must match the actual GitHub owner (plan says `Or4cu1o`: use `io.github.Or4cu1o/...` - case handling of namespace is Unverified).
4. Keep `server.json` description <= 100 chars; keep `version` in sync across package.json, server.json, plugin.json, MCPB manifest (single release script).
5. Treat download tool (write) as the only path needing roots: use `roots/list` plus `MOTHDEX_DOWNLOAD_DIR`; do not depend on roots in Desktop (Unverified).

## Risks

- Registry is preview: data resets, breaking changes possible; schema URL dated 2025-12-11 may be superseded (draft changes pending).
- v2 is young (about 4 months); 2.x minor releases roughly monthly. Pin exact versions and use the lockfile.
- MCPB spec 0.3 vs 0.4 split; Claude Desktop acceptance of 0.4 unverified; stay on 0.3 (node type).
- Registry fetches package metadata at publish time: npm must be published first, `mcpName` mismatch fails validation.
- Org namespace publishing blocked on interactive login (issue #1468); the CI path is required.
- `mcp-publisher` is downloaded in CI: supply-chain risk, pin + cosign verify.

## Open questions

1. Does Claude Desktop (current release) connect to a v2 SDK server (protocol negotiation) and answer `roots/list`? Not verified.
2. Does `mcpb validate` of the example pass on CLI 2.1.2 (not run; CLI not installed here)? Not verified.
3. Registry GA date and whether `$schema` newer than 2025-12-11 exists on static.modelcontextprotocol.io. Not verified.
4. Is `io.github.<owner>` case-sensitive against GitHub login (`Or4cu1o`)? Not verified.
5. Does trusted publishing (npm OIDC) require configuring the package on npmjs.com first (chicken-and-egg for first publish)? Not verified.
