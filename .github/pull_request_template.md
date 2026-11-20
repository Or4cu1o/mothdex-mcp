## What and why

<!-- One or two sentences. Link the issue or task ref. -->

## Risk level

- [ ] Low (docs, text, styling, config values)
- [ ] Medium (bug fix or change of existing behavior)
- [ ] High (LLM-controlled file writes, CI/release, secrets, supply chain)

## Checklist

- [ ] Branch is named `type/short-name`; commits follow Conventional Commits
- [ ] `CHANGELOG.md` has an entry under `Unreleased`
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass locally
- [ ] No secrets, tokens or `.env` files in the diff
- [ ] README/docs updated if behavior or structure changed
