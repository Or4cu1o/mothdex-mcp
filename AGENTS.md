# AGENTS.md

Guidance for humans and coding agents working in this repository.

## Project

`mothdex-mcp`: MCP server (TypeScript, stdio) for the Mothdex API v1. Status:
pre-alpha skeleton. The MCP SDK is not a dependency yet. Plugin packaging
(`.claude-plugin/`, `.mcp.json`, `skills/`, `commands/`) is not part of the
skeleton.

## Commands

```sh
pnpm install --frozen-lockfile                  # install (pnpm only)
pnpm lint                                       # biome check
pnpm format                                     # biome check --write
pnpm typecheck                                  # tsc --noEmit
pnpm test                                       # vitest
pnpm build                                      # esbuild -> dist/mothdex-mcp.mjs
node dist/mothdex-mcp.mjs                       # run (prints version)
pnpm audit --prod                               # known vulnerabilities
gitleaks git --pre-commit --staged --redact     # secrets scan before every commit
```

## Rules

- Branch `type/short-name`; Conventional Commits; no direct push to `main`.
- Never write, print or commit secrets or `.env`; use `.env.example`.
- CHANGELOG entry under `Unreleased` in every PR; update README when structure changes.
- GitHub Actions are pinned by full commit SHA with a version comment; the
  workflow `GITHUB_TOKEN` stays read-only unless a job needs more.
- Dependencies: pnpm and its lockfile only; check license and maintenance first.
- Tests: see CONTRIBUTING.md. Never call the real API from tests.

## Risk map

The riskiest file in a change sets the level of the whole change.

| Surface                                                                                                                | Level                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Docs, README, styles                                                                                                   | Low                                   |
| Read tools, resources, prompts, API client                                                                             | Medium                                |
| Writing files with a path or name chosen by an LLM or the server (`download_file`)                                     | **High**                              |
| CI workflows (`.github/workflows`), Dependabot, release, bundle integrity, publishing (npm, `.mcpb`, registry), tokens | **High** (supply chain and secrets)   |
| Archiving repositories, merges, releases, publications                                                                 | external action: needs owner approval |
