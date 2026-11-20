# T1c - Claude Code plugin spec for mothdex-mcp

Ref: T1c. Date checked: 2026-11-20. Claude Code used locally: 2.1.329. Analyst: Sonda.
Supports: PLAN-v0.md section 3.2 (`.claude-plugin/`, `.mcp.json`, `skills/`, `commands/`, repo as marketplace).

## Question
What is the current Claude Code plugin format, and can one repo be marketplace and plugin at once, bundling a Node MCP server?

## Short answer
- Yes. A repo with `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` (entry `source: "./"`) + `.mcp.json` + `skills/` + `commands/` is valid. I built exactly that layout and `claude plugin validate . --strict` returned success (exit 0), listing mcpServers, skills `mothdex:mothdex`, commands `mothdex:search`.
- Only `name` is required in plugin.json (the manifest itself is optional). Marketplace requires `name`, `owner`, `plugins[]`; each entry requires `name`, `source`.
- Users add it with `/plugin marketplace add owner/repo` (shell: `claude plugin marketplace add owner/repo`), then `claude plugin install <plugin>@<marketplace>`.
- Validation: `claude plugin validate <path> [--strict] [--json] [--profile directory]`. No `/plugin validate` slash command found in docs (Unverified; the docs only describe the shell command).
- Plan deviation: `commands/` is documented as legacy ("Prefer skills/ for new plugins"); skills already get `/plugin:skill` names. Plan can keep commands/ but skills alone suffice.
- Plan item to check: the plan names the marketplace `Or4cu1o/mothdex-mcp`; plugin/marketplace names must avoid reserved/Anthropic-like names (see table). `mothdex` is fine.

## Evidence
| # | Claim | Label | Source | Version | Checked |
|---|---|---|---|---|---|
| 1 | `plugin.json` lives at `.claude-plugin/plugin.json`; manifest optional; `name` only required field; other dirs (skills/, commands/, hooks/) at plugin root, not inside `.claude-plugin/` | Confirmed | https://code.claude.com/docs/en/plugins-reference (manifest reference) | CC docs 2026-11 | 2026-11-20 |
| 2 | Optional fields: displayName, version, description, author{name,email,url}, homepage, repository, license, keywords, defaultEnabled, engines{claude-code}, dependencies, network{hosts}, userConfig, skills, commands, agents, hooks, mcpServers, lspServers, outputStyles, workflows, channels, experimental, metadata, `$schema`, icon/documentationUrl/supportUrl/privacyPolicyUrl/termsOfServiceUrl (directory listing only) | Confirmed | same | same | 2026-11-20 |
| 3 | Unknown top-level key stripped (warning in validate); unknown key inside userConfig/channels/lspServers/monitors is an error | Confirmed | same | same | 2026-11-20 |
| 4 | Component paths must start with `./`, stay inside plugin root, and exist | Confirmed | same ("Path rules") | same | 2026-11-20 |
| 5 | `.mcp.json` at plugin root and/or inline `mcpServers` in plugin.json are both loaded; `.mcp.json` first, later name replaces earlier. `mcpServers` also accepts a `.json` path, `.mcpb`/`.dxt` bundle path or https URL | Confirmed | plugins-reference + https://code.claude.com/docs/en/mcp (Plugin-provided MCP servers) | same | 2026-11-20 |
| 6 | `.mcp.json` shape used in docs wraps servers in `"mcpServers": {...}` | Confirmed | mcp docs; my local validate accepted it | CC 2.1.329 | 2026-11-20 |
| 7 | `${CLAUDE_PLUGIN_ROOT}` (installed version dir, changes on update), `${CLAUDE_PLUGIN_DATA}` (persistent, `~/.claude/plugins/data/<id>/`), `${CLAUDE_PROJECT_DIR}` resolve in stdio `command`,`args`,`env`; http/sse/ws `url`,`headers`,`headersHelper`; also exported as env vars to stdio servers | Confirmed | plugins-reference "Environment variables" | same | 2026-11-20 |
| 8 | `userConfig` keys: type (string/number/boolean/directory/file), title, description required; required, default, options, multiple, sensitive, min/max optional. Sensitive values go to the OS credential store. Substitution `${user_config.KEY}` works in MCP server config, LSP config, exec-form hook args, skill/agent content (non-sensitive only); `CLAUDE_PLUGIN_OPTION_<KEY>` env for hooks. validate errors on `${user_config.X}` not declared (CC >= 2.1.281) | Confirmed | plugins-reference "User configuration" | same | 2026-11-20 |
| 9 | Skills: `skills/<name>/SKILL.md`; frontmatter all optional, `description` recommended; fields name, description, when_to_use, argument-hint, arguments, disable-model-invocation, user-invocable, allowed-tools, disallowed-tools, model, effort, context, agent, background, hooks, paths, shell, metadata, license, compatibility. description+when_to_use truncated at 1,536 chars in listing | Confirmed | https://code.claude.com/docs/en/skills | same | 2026-11-20 |
| 10 | Namespacing: plugin skill `skills/review/SKILL.md` is `/plugin-name:review`; frontmatter `name` replaces the last segment; bare `/name` also works unless taken. Components are namespaced under manifest `name` | Confirmed | skills docs + plugins-reference `name` | same | 2026-11-20 |
| 11 | `commands/` = flat `.md` files, "Prefer skills/ for new plugins"; setting manifest `commands` REPLACES default `commands/` scan; `skills` ADDS; hooks/mcpServers/lspServers MERGE | Confirmed | plugins-reference "Standard layout", "How each key combines" | same | 2026-11-20 |
| 12 | Local test: command file `commands/search.md` shows as `mothdex:search`; skill as `mothdex:mothdex` | Confirmed | `claude plugin validate .` output on my scratch plugin | CC 2.1.329 | 2026-11-20 |
| 13 | marketplace.json at `.claude-plugin/marketplace.json`; required `name`,`owner{name}`,`plugins[]`; entry requires `name`,`source`; name chars letters/digits/`.`/`_`/`-`; `description` recommended (warning if missing) | Confirmed | https://code.claude.com/docs/en/plugins/marketplace-reference.md | same | 2026-11-20 |
| 14 | Relative `source` must start with `./`; `"."` alone means the root; resolves from marketplace root. A root plugin (`"./"`) with git submodules: all-or-none fetch rule (v2.1.295+) | Confirmed | marketplace-reference "Relative path plugin source" | same | 2026-11-20 |
| 15 | Add syntax: `claude plugin marketplace add <source>`; `owner/repo`, `owner/repo@ref`, `owner/repo#ref`, git URLs, local paths; flags `--scope user|project|local` (default user), `--sparse`, `--json`; in-session `/plugin marketplace add owner/repo` | Confirmed | marketplace-reference "Marketplace sources"; `claude plugin marketplace add --help` | CC 2.1.329 | 2026-11-20 |
| 16 | Install id = `<entry name>@<marketplace name>`; entry name and plugin.json `name` should match | Confirmed | https://code.claude.com/docs/en/plugins/create-marketplace.md | same | 2026-11-20 |
| 17 | Reserved/blocked names: marketplace names like claude-plugins-official, anthropic-*, claude-code-*, `claudeai-*` prefix, etc.; plugin names starting `claude-`, `anthropic-`, `cc-plugin-` error; `claude`/`anthropic` as whole word warns | Confirmed | marketplace-reference "Reserved names"; plugins-reference `name` | same | 2026-11-20 |
| 18 | `version` in plugin.json pins users to that version until it changes (set it per release or users do not update); plugin.json version wins over entry version | Confirmed | plugins-reference `version`; marketplace-reference entry table | same | 2026-11-20 |
| 19 | Validate: `claude plugin validate <path>`; options `--strict` (warnings fail), `--json`, `--profile directory` (also fail on directory-submission checks e.g. missing README). Exit 0 ok, 1 failed, 2 unexpected error. Accepts plugin dir, marketplace dir, or file named `marketplace.json`; when a dir has both, it validated the marketplace and ran plugin checks | Confirmed | `claude plugin validate --help`; plugin cli-reference; local run | CC 2.1.329 | 2026-11-20 |
| 20 | `/plugin validate` in-session | Unverified | not found in docs (cli-reference lists `/plugin` and `/reload-plugins` only) | - | 2026-11-20 |
| 21 | Claude Code answers MCP `roots/list` with the launch dir + `--add-dir` dirs; sends `notifications/roots/list_changed` on change; `CLAUDE_PROJECT_DIR` is not the right signal for allowed-dirs | Confirmed | https://code.claude.com/docs/en/mcp (stdio section) | same | 2026-11-20 |
| 22 | Install-time: `.mcp.json` hosts not declared produce a note; `network.hosts` in plugin.json is informational only, not enforced | Confirmed | plugins-reference `network`; local validate output | CC >= 2.1.328 | 2026-11-20 |

## Verified minimal examples
All three passed `claude plugin validate . --strict` (exit 0) in a scratch dir (README/icon only trigger optional `--profile directory` findings).

`.claude-plugin/plugin.json`
```json
{
  "name": "mothdex",
  "displayName": "Mothdex",
  "version": "0.1.0",
  "description": "Search and resolve downloads from the Mothdex catalog",
  "author": { "name": "Example Owner" },
  "homepage": "https://example.com/mothdex",
  "repository": "https://github.com/example/mothdex-mcp",
  "license": "MIT",
  "keywords": ["mcp", "roms"],
  "userConfig": {
    "download_dir": {
      "type": "directory",
      "title": "Download directory",
      "description": "Where download_file may write",
      "required": false
    }
  }
}
```
Strictly minimal valid manifest: `{ "name": "mothdex" }`.

`.mcp.json` (plugin root)
```json
{
  "mcpServers": {
    "mothdex": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mothdex-mcp.mjs"],
      "env": { "MOTHDEX_DOWNLOAD_DIR": "${user_config.download_dir}" }
    }
  }
}
```

`.claude-plugin/marketplace.json` (same repo, root plugin)
```json
{
  "name": "mothdex-mcp",
  "description": "Mothdex MCP server plugin",
  "owner": { "name": "Example Owner" },
  "plugins": [
    {
      "name": "mothdex",
      "source": "./",
      "description": "Search and resolve downloads from the Mothdex catalog"
    }
  ]
}
```

`skills/mothdex/SKILL.md` header: `---` / `name: mothdex` / `description: ... Use when ...` / `---`. `commands/search.md` header: `description`, `argument-hint`; body may use `$ARGUMENTS` (Inferred from skills docs; my validate accepted it, runtime substitution not run).

## Options compared
| Option | Pros | Cons |
|---|---|---|
| A. Repo = marketplace + plugin, `source: "./"` (plan) | One repo, one `marketplace add` command, validated | Whole repo is the plugin root (src/, tests copied into the plugin cache unless excluded - Unverified whether .gitignore/files are respected); git-submodule all-or-none rule |
| B. Marketplace entry points to subdir `./plugin` | Smaller install, clean separation | `${CLAUDE_PLUGIN_ROOT}` is the subdir, so `dist/` must live inside it; release build must copy bundle there |
| C. Plugin `mcpServers` -> `.mcpb` bundle | Same artifact as Desktop | Docs say extracted into `mcpb/` under plugins root; adds a moving part; Unverified in practice |
| D. `npx` command in `.mcp.json` instead of bundled dist | No dist committed | Needs network + npm at start, slower, supply-chain exposure; bundle in repo is more hermetic |

## Recommendation
Option A with a committed `dist/mothdex-mcp.mjs` built at release (matches plan), `.mcp.json` calling `node ${CLAUDE_PLUGIN_ROOT}/dist/mothdex-mcp.mjs`. Conditions:
1. Set `version` in plugin.json and bump per release (otherwise pinned users never update); keep entry `name` == manifest `name`.
2. Use a distinctive marketplace `name` (users cannot register two with the same name).
3. Gate CI with `claude plugin validate . --strict`; run `--profile directory` only if submitting to Anthropic's directory (needs README with install line, icon).
4. Pass the download dir via `userConfig` (`type: directory`) and read roots via MCP `roots/list` as fallback.
5. Prefer skills over commands; keep `commands/` only if `/mothdex:search` explicit commands are wanted (skills with `user-invocable` default already appear in `/` menu).

## Risks
- Docs move quickly (many `requires CC >= 2.1.2xx` notes); `engines.claude-code` can gate, but old clients (2.0.15-2.1.75) reject manifests with `engines`. Do not set `engines` unless needed.
- `userConfig.options` blocks Claude Code < 2.1.271; MCP checks need >= 2.1.281.
- Server `env` with an unset non-required `${user_config.download_dir}` substitution behaviour: Unverified (validate passes; runtime result with empty value not tested).
- `-p` headless/other hosts (Cowork/claude.ai) may differ; not checked.

## Open questions
1. Does the plugin cache copy the whole repo for `source: "./"` (size, src/ exposure)? Not verified; test with a real `marketplace add` of a git repo.
2. Runtime behaviour of an unset optional `userConfig` in `env`: omitted, empty, or literal? Not verified.
3. Do we want `network.hosts` declared (informational) for the Mothdex API host? Owner decision.
