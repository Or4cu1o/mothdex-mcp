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
  stdio smoke test. `attest` (OIDC) attests the files. `publish` (environment `release`) re-verifies checksums and
  attestations (signer workflow and tag) before `gh release create --verify-tag`.
- No job uses a dependency cache; third-party actions are pinned by commit SHA; the tag name only reaches the shell
  through an environment variable.

## Verifying a download

```sh
sha256sum --check --ignore-missing checksums.txt
gh attestation verify mothdex-mcp_X.Y.Z.mjs --repo Or4cu1o/mothdex-mcp \
  --signer-workflow Or4cu1o/mothdex-mcp/.github/workflows/release.yml --source-ref refs/tags/vX.Y.Z
```

## Owner settings the pipeline relies on (not changed by this repo)

- Environment `release` with required reviewers (the `publish` job waits for it).
- A tag ruleset for `v*` (only the owner can create or move release tags).
- Do not mark the release workflow as a required check (it only runs on tags).

## Release steps (owner OK needed for steps 2 and 3)

1. **Prepare** (PR): bump `version` in `package.json` and `.claude-plugin/plugin.json` (`node scripts/check-versions.mjs`),
   move the CHANGELOG entries under the version, `pnpm build`, commit `dist/mothdex-mcp.mjs`, merge.
2. **Tag** `vX.Y.Z` on that `main` commit. The workflow builds, attests and (after approval of the `release`
   environment) publishes the release.
3. **Pin the marketplace** (PR): a `source: "./"` marketplace entry follows `main` HEAD, so a user would run whatever was
   last merged. After the tag exists, change the entry in `.claude-plugin/marketplace.json` to:

   ```json
   "source": { "source": "github", "repo": "Or4cu1o/mothdex-mcp", "ref": "vX.Y.Z", "sha": "<git rev-list -n1 vX.Y.Z>" }
   ```

   `claude plugin validate .claude-plugin/marketplace.json --strict` checks the shape (a 40-character lowercase `sha`).
   Users then install exactly the attested tag; the next release repeats step 3. Local development keeps using
   `source: "./"` on a branch (`claude plugin marketplace add ./`). Do not announce the plugin before step 3 is merged.
