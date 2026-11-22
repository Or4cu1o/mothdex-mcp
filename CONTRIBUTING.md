# Contributing

Thanks for helping. The project is pre-alpha; open an issue before starting
anything large.

## Branches and commits

- Branch from `main` as `type/short-name` (for example `fix/limit-validation`).
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
  `chore`, `revert`, with an optional scope (`fix(client): ...`).
- Never push directly to `main` and never force-push shared branches. Changes
  land through pull requests.
- One commit per complete unit of work.

## Pull requests

- Add your changelog entry as a fragment `changes/<branch>.md` in the same PR (format in [changes/README.md](changes/README.md)); do not edit [CHANGELOG.md](CHANGELOG.md), the release step folds the fragments into it.
- Update `README.md` if structure or behavior changes.
- CI must be green. Do not commit secrets, tokens or `.env` files.

## Local checks

Install Node (see `.node-version`) and pnpm (version in `package.json`, for
example through `corepack enable`), then run:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
gitleaks git --pre-commit --staged --redact
```

Node baseline: `engines.node` is `>=22` and the bundle targets `node22` (the oldest LTS still supported; the MCP SDK
needs >=20). `.node-version` and CI use 26, so avoid APIs newer than Node 22.

Use `pnpm format` to apply Biome fixes. Use the lockfile manager only: do not
use npm or yarn, and check license and maintenance before adding a dependency.

## Tests

Test behavior that matters: security-sensitive paths, file writes, contracts
with the API (against fixtures), and pure decision rules. Add one regression
test per bug. Do not add snapshot tests or tests that depend on the real clock
or on `sleep`. Tests never call the real API.

## API fixtures

`src/api/testdata/api-v1/` is a copy of the fixtures owned by mothdex-cli. The `fixtures` CI job compares it with
mothdex-cli `main`, so a fixture change there turns every pull request here red until
`node scripts/check-fixtures.mjs --update` is run and the result is committed. That is the intended drift signal.
The job depends on the GitHub API, so keep it out of the required checks.

## License

By contributing you agree that your contributions are licensed under GPL-3.0.
