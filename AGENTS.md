# AGENTS.md

Guidance for humans and coding agents working in this repository.

## Project

`mothdex-mcp`: MCP server (TypeScript, stdio) for the Mothdex API v1. Status: pre-alpha. Read tools, resources and
prompts work; `download_file` is opt-in (`src/server/download/`, tools.md §3). Plugin packaging is in
`.claude-plugin/`, `.mcp.json` and `skills/`.

Node baseline: `engines.node >=22` and the esbuild target `node22` (the oldest LTS still supported; Node 20 is end
of life; tools.md decision). CI and `.node-version` use 26. `@types/node` 26 can expose APIs missing on Node 22, so
keep the minimum and the types aligned when it changes and avoid APIs newer than Node 22.

## Commands

```sh
pnpm install --frozen-lockfile                  # install (pnpm only)
pnpm lint                                       # biome check
pnpm format                                     # biome check --write
pnpm typecheck                                  # tsc --noEmit
pnpm test                                       # vitest
pnpm build                                      # esbuild -> dist/mothdex-mcp.mjs
pnpm check:fixtures                             # src/api/testdata copy vs mothdex-cli main (network)
node dist/mothdex-mcp.mjs                       # stdio MCP server (--version prints the version)
pnpm audit --audit-level high                      # known vulnerabilities (all deps, incl. toolchain)
gitleaks git --pre-commit --staged --redact     # secrets scan before every commit
```

## Rules

- Branch `type/short-name`; Conventional Commits; no direct push to `main`.
- Never write, print or commit secrets or `.env`; use `.env.example`.
- Changelog: add your entry as a fragment `changes/<branch>.md` (format in `changes/README.md`), never by editing `CHANGELOG.md`; the release step folds the fragments. Update README when structure changes.
- GitHub Actions are pinned by full commit SHA with a version comment; the
  workflow `GITHUB_TOKEN` stays read-only unless a job needs more.
- Dependencies: pnpm and its lockfile only; check license and maintenance first.
  `pnpm-workspace.yaml` enforces a 7-day minimum release age, no unreviewed build
  scripts, no exotic sub-dependencies and no trust downgrades; do not relax it
  without a security review.
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
