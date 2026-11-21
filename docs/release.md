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
  (environment `release`) re-verifies checksums and attestations (signer workflow, tag, `--source-digest` of that
  commit, no self-hosted runner), checks that the files to upload are exactly the ones `checksums.txt` lists plus itself,
  and as its last check before `gh release create --verify-tag` that the tag still resolves to the commit that was built
  (annotated tags followed, one API call per object).
- `ci.yml` also lints the workflows with a pinned actionlint image.
- No job uses a dependency cache; third-party actions are pinned by commit SHA; the tag name only reaches the shell
  through an environment variable.

## Verifying a download

The provenance example needs a clone with the tag fetched (`git fetch --tags`); otherwise use the commit SHA of the tag
instead of `git rev-list`.

```sh
sha256sum --check --ignore-missing checksums.txt
gh attestation verify mothdex-mcp_X.Y.Z.mjs --repo Or4cu1o/mothdex-mcp \
  --signer-workflow Or4cu1o/mothdex-mcp/.github/workflows/release.yml --source-ref refs/tags/vX.Y.Z \
  --source-digest "$(git rev-list -n1 vX.Y.Z)" --deny-self-hosted-runners
```

A plugin user can check the bundle the plugin actually runs the same way: the installed
`<plugin dir>/dist/mothdex-mcp.mjs` is byte for byte the release asset, so the same `gh attestation verify` works on
that path (the attestation is looked up by the file's digest, not its name).

## Owner settings the pipeline relies on (not changed by this repo)

- Environment `release` with required reviewers (the `publish` job waits for it).
- A tag ruleset for `v*` that blocks **creation by anyone but the owner, update and deletion**: the check that the tag
  still points at the built commit leaves a short window before `gh release create`, which only the ruleset closes. Residual: a ruleset bypass for the repository admin role lets an admin
  still move a `v*` tag; that check is what catches it inside a run, and immutable releases lock the tag once the release is
  published (a repository setting: owner-checked, Sentinela saw it enabled in the T-24 review). Drop the bypass and lift it only when needed, if that residual matters.
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

## First release v0.1.0: owner checklist (T-34-owner, T-23)

Prepared at main `bf994da`. **OWNER OK** marks a settings change, the tag or a publish. `release.yml` has never run on a tag.

1. **Gates before the tag.** CI green on `main` (including `dist == build(src)`, `actionlint`, marketplace validation);
   gitleaks clean; the agents' bot identity replaces the owner identity (D14, **OWNER OK**, owner decision open: which
   account, and whether it may create the tag given the ruleset below).
2. **Settings (OWNER OK):** environment `release` with the owner as required reviewer, restricted to tags `v*`; tag ruleset
   for `v*` (creation only by the owner or the bot, update and deletion blocked); `dist == build(src)` as a required check
   on `main`; recommended, immutable releases.
3. **Prepare PR:** `package.json` and `.claude-plugin/plugin.json` are already `0.1.0`
   (`node scripts/check-versions.mjs`); move the CHANGELOG `[Unreleased]` entries under `## [0.1.0] - <date>`;
   `pnpm build` must leave `dist/mothdex-mcp.mjs` unchanged; check the plugin with `claude --plugin-dir .`. Merge, note the
   full SHA of the merge commit (`git rev-parse origin/main`).
4. **Tag (OWNER OK):** `git tag -a v0.1.0 -m "mothdex-mcp v0.1.0" <sha> && git push origin v0.1.0` (never `--force`).
   Approve the `release` environment in the Actions run only after `build` and `attest` are green.
5. **Verify the published release** (empty directory):

   ```sh
   gh release download v0.1.0 --repo Or4cu1o/mothdex-mcp          # expect 2 files: mothdex-mcp_0.1.0.mjs, checksums.txt
   sha256sum --check --strict checksums.txt
   gh attestation verify checksums.txt --repo Or4cu1o/mothdex-mcp \
     --signer-workflow Or4cu1o/mothdex-mcp/.github/workflows/release.yml --source-ref refs/tags/v0.1.0 \
     --source-digest <full sha of the tag commit> --deny-self-hosted-runners
   gh attestation verify mothdex-mcp_0.1.0.mjs  # same flags
   cmp mothdex-mcp_0.1.0.mjs <(git show v0.1.0:dist/mothdex-mcp.mjs)   # in a clone: asset == committed dist
   ```

   There is no cosign signature and no SBOM in this repo's release; the attestation is the provenance.
6. **Pin PR** (step 3 of the release steps above): marketplace `source` to the tag and commit, validate with
   `claude plugin validate .claude-plugin/marketplace.json --strict`. Merge nothing between the tag and this PR; do not
   announce the plugin before it merges. After the pin, install from the marketplace once and check
   `<plugin dir>/dist/mothdex-mcp.mjs` with `gh attestation verify` (same flags).
7. **Rollback.** Failure before `publish`: nothing published; fix, merge, use a **new** tag (`v0.1.1`), never move
   `v0.1.0`. Published but wrong: `gh release edit v0.1.0 --prerelease`, point the marketplace pin back to the last good
   tag (or remove the plugin entry) in a PR, ship `v0.1.1`; deleting a release or tag needs the owner's OK. No long-lived
   secrets are involved (OIDC), so there is nothing to rotate.

Verified while preparing this: `actionlint` (pinned image) clean; `release.yml` read against these steps. **Not
verified:** any real tag run (`gh attestation verify`, the tag-to-commit check, `--verify-tag`, the environment approval), and
the marketplace install from the pinned tag.
