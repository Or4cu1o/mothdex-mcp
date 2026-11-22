### Changed

- T-76: a pull request no longer edits `CHANGELOG.md`: it adds `changes/<branch>.md` (see `changes/README.md`), and the release step runs
  `scripts/changelog-fold.sh` to fold the fragments into `CHANGELOG.md` and delete them, so open pull requests stop conflicting on the changelog. CI checks
  the fragments with `scripts/changelog-fold.sh --check`. `AGENTS.md`, `CONTRIBUTING.md`, the pull request template and the release checklist say so.
  The existing `CHANGELOG.md` content is untouched.
