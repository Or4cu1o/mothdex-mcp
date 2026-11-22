# Changelog fragments

A pull request does **not** edit `CHANGELOG.md`. It adds one small file here instead, so two open pull requests never
conflict on the changelog. The person who prepares a release folds the fragments into `CHANGELOG.md` and deletes them.

## Writing a fragment

Create `changes/<branch-name>.md` (lower-case letters, digits, `.`, `_` and `-` only; the branch name is a good choice
because it is unique among open pull requests). The file has one or more sections, each a `###` heading followed by the
entries as you would write them in the changelog:

```markdown
### Added

- T-99: the `frobnicate` tool returns the frobnication state (tools.md 3.9).

### Fixed

- A tool error no longer repeats the request id twice.
```

Rules (checked in CI by `scripts/changelog-fold.sh --check`):

- The section is one of `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` or `Security`.
- Nothing comes before the first `###` heading, and every section has at least one entry.
- Entries are the same text you would have added to `CHANGELOG.md`: start with the task or PR reference, one bullet per
  change, continuation lines indented by two spaces.
- A pull request with nothing worth a changelog line needs no fragment.

## Folding at release time

```sh
scripts/changelog-fold.sh                  # add the fragments to the [Unreleased] section and delete them
scripts/changelog-fold.sh --release 0.2.0  # the same, then [Unreleased] becomes [0.2.0] - <today>, with a fresh empty [Unreleased]
```

The script only adds text in front of the existing content of `CHANGELOG.md` (grouped by section, fragments in file name
order); it never rewrites what is already there, so a section heading may appear twice in `[Unreleased]` until the
release is cut. Review the result, then commit it in the release pull request.
