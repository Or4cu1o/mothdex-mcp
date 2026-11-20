# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project skeleton: pnpm, strict TypeScript, Biome, Vitest, esbuild bundle to
  `dist/mothdex-mcp.mjs`, minimal entry point that prints its version.
- GPL-3.0 license, governance documents, issue and pull request templates.
- CI for pull requests and `main` (install with frozen lockfile, lint, typecheck,
  test, build on Linux, Windows and macOS; `pnpm audit` of production
  dependencies; gitleaks) with actions pinned by commit SHA.
- Dependabot for npm and GitHub Actions.

[Unreleased]: https://github.com/Or4cu1o/mothdex-mcp/commits/main
