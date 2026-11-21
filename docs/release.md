# Release process and verification

The release is a tag. Nothing here runs until the owner creates a `v*` tag; no workflow publishes from a branch.

## What a release contains

- `mothdex-mcp_<version>.mjs`: the single-file server bundle. Byte for byte the same as the committed
  `dist/mothdex-mcp.mjs` at the tag (the build job fails otherwise).
- `checksums.txt` (SHA-256), and a GitHub build-provenance attestation for both files.

## How the pipeline works

- `ci.yml` job `dist == build(src)` rebuilds the bundle on every PR (frozen lockfile, `--ignore-scripts`, no
  dependency cache) and fails if `dist/mothdex-mcp.mjs` differs from what is committed. esbuild output is
  deterministic for a given lockfile (checked: two builds give the same SHA-256).
- `release.yml` (tag `vX.Y.Z[-pre]` only): build (read-only) requires the tag to be on `main`, the tag, `package.json`
  and `plugin.json` versions to agree, lint, typecheck, tests, build, a clean tree (committed dist == build) and the
  stdio smoke test of the dist and of the staged release file. `attest` (OIDC) attests the files. `publish`
  (environment `release`) first checks that the tag still resolves to the commit that was built (annotated tags
  followed), then re-verifies checksums and attestations (signer workflow, tag, `--source-digest` of that commit, no
  self-hosted runner) before `gh release create --verify-tag`.
- `ci.yml` also lints the workflows with a pinned actionlint image.
- No job uses a dependency cache; third-party actions are pinned by commit SHA; the tag name only reaches the shell
  through an environment variable.

## Verifying a download

```sh
sha256sum --check --ignore-missing checksums.txt
gh attestation verify mothdex-mcp_X.Y.Z.mjs --repo Or4cu1o/mothdex-mcp \
  --signer-workflow Or4cu1o/mothdex-mcp/.github/workflows/release.yml --source-ref refs/tags/vX.Y.Z \
  --source-digest <commit of the tag: git rev-list -n1 vX.Y.Z> --deny-self-hosted-runners
```

A plugin user can check the bundle the plugin actually runs the same way: the installed
`<plugin dir>/dist/mothdex-mcp.mjs` is byte for byte the release asset, so the same `gh attestation verify` works on
that path (the attestation is looked up by the file's digest, not its name).

## Owner settings the pipeline relies on (not changed by this repo)

- Environment `release` with required reviewers (the `publish` job waits for it).
- A tag ruleset for `v*` that blocks **creation by anyone but the owner, update and deletion**: the check that the tag
  still points at the built commit leaves a short window before `gh release create`, which only the ruleset closes.
- Required status checks on `main`, including `dist == build(src)`: `.gitattributes` hides the bundle from PR diffs, so
  that job is the only control on its content. Do not mark the release workflow as required (it only runs on tags).
- Recommended: enable immutable releases, so assets cannot be replaced after publishing.

## Release steps (owner OK needed for steps 2 and 3)

1. **Prepare** (PR): bump `version` in `package.json` and `.claude-plugin/plugin.json` (`node scripts/check-versions.mjs`),
   move the CHANGELOG entries under the version, `pnpm build`, commit `dist/mothdex-mcp.mjs`, merge. Check the plugin
   against the working tree with `claude --plugin-dir .` (not `marketplace add ./`: after the first pin that entry
   points at an older tag).
2. **Tag** `vX.Y.Z` on that `main` commit. The workflow builds, attests and (after approval of the `release`
   environment) publishes the release.
3. **Pin the marketplace** (PR): a `source: "./"` marketplace entry follows `main` HEAD, so a user would run whatever was
   last merged. After the tag exists, change the entry in `.claude-plugin/marketplace.json` to:

   ```json
   "source": { "source": "github", "repo": "Or4cu1o/mothdex-mcp", "ref": "vX.Y.Z", "sha": "<git rev-list -n1 vX.Y.Z>" }
   ```

   `claude plugin validate .claude-plugin/marketplace.json --strict` checks the shape (a 40-character lowercase `sha`).
   Users then install exactly the attested tag; the next release repeats step 3. Local development keeps using
   `source: "./"` in a scratch marketplace or with `claude --plugin-dir .`. Do not announce the plugin before step 3 is
   merged. For the first release, merge nothing between the tag and the pin PR, so `main` is the tag commit plus the pin.
