# Release process and verification

The release is a tag. Nothing here runs until the owner creates a `v*` tag; no workflow publishes from a branch.

## What a release contains

- `mothdex-mcp_<version>.mjs`: the single-file server bundle. Byte for byte the same as the committed
  `dist/mothdex-mcp.mjs` at the tag (the build job fails otherwise).
- `mothdex-mcp_<version>.mcpb`: the MCP Bundle for clients that install `.mcpb` files. It holds exactly two files, the
  `manifest.json` (`mcpb/manifest.json`) and `dist/mothdex-mcp.mjs`, both byte for byte the committed ones. There is no icon
  yet (backlog `mcpb-icon`, after the brand session); the list check in `scripts/pack-mcpb.sh` says so and changes when it lands.
- `checksums.txt` (SHA-256 of both files), and a GitHub build-provenance attestation for each of them and for `checksums.txt`.

## How the pipeline works

- `ci.yml` job `dist == build(src)` rebuilds the bundle on every PR (frozen lockfile, `--ignore-scripts`, no
  dependency cache) and fails if `dist/mothdex-mcp.mjs` differs from what is committed. esbuild output is
  deterministic for a given lockfile (checked: two builds give the same SHA-256).
- `release.yml` (tag `vX.Y.Z[-pre]` only): build (read-only) requires the tag to be on `main`, the tag, `package.json`
  and `plugin.json` versions to agree, lint, typecheck, tests, build, a clean tree (committed dist == build), the stdio
  smoke test of the dist, `pnpm check:package`, the pinned mcpb CLI (`tools/mcpb`, its own frozen lockfile, install
  scripts off), `scripts/pack-mcpb.sh` (validate, pack, exact member list, members equal the committed files, stdio smoke
  of the bundle inside the archive) and the stdio smoke test of the staged release file. `attest` (OIDC) attests the files. `publish`
  (environment `release`) re-verifies checksums and attestations (signer workflow, tag, `--source-digest` of that
  commit, no self-hosted runner), checks that the files to upload are exactly the ones `checksums.txt` lists plus itself,
  and as its last check before `gh release create --verify-tag` that the tag still resolves to the commit that was built
  (annotated tags followed, one API call per object).
- `ci.yml` also lints the workflows with a pinned actionlint image, and its `dist == build(src)` job runs `pnpm check:package`
  and `scripts/pack-mcpb.sh` on every pull request, so the `.mcpb` path is exercised before any tag. No new check name:
  both run inside that existing job.
- `tools/mcpb` is release tooling only (never shipped, never part of the app lockfile). Its `pnpm-workspace.yaml` keeps the
  root's supply-chain policy and adds one reviewed exception, `undici-types@6.21.0` (see the pull request that added it);
  the exception is the owner's to accept.
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

The same `gh attestation verify` (same flags) works for `mothdex-mcp_X.Y.Z.mcpb`.

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
   run `scripts/changelog-fold.sh --release <version>` (folds the `changes/` fragments into `CHANGELOG.md` and moves the entries under the version), `pnpm build`, commit `dist/mothdex-mcp.mjs`, merge. Check the plugin
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
   (`node scripts/check-versions.mjs`); run `scripts/changelog-fold.sh --release 0.1.0` (folds the `changes/` fragments and moves the `[Unreleased]` entries under `## [0.1.0] - <date>`);
   `pnpm build` must leave `dist/mothdex-mcp.mjs` unchanged; check the plugin with `claude --plugin-dir .`. Merge, note the
   full SHA of the merge commit (`git rev-parse origin/main`).
4. **Tag (OWNER OK):** `git tag -a v0.1.0 -m "mothdex-mcp v0.1.0" <sha> && git push origin v0.1.0` (never `--force`).
   Approve the `release` environment in the Actions run only after `build` and `attest` are green.
5. **Verify the published release** (empty directory):

   ```sh
   gh release download v0.1.0 --repo Or4cu1o/mothdex-mcp          # expect 3 files: mothdex-mcp_0.1.0.mjs, mothdex-mcp_0.1.0.mcpb, checksums.txt
   sha256sum --check --strict checksums.txt
   gh attestation verify checksums.txt --repo Or4cu1o/mothdex-mcp \
     --signer-workflow Or4cu1o/mothdex-mcp/.github/workflows/release.yml --source-ref refs/tags/v0.1.0 \
     --source-digest <full sha of the tag commit> --deny-self-hosted-runners
   gh attestation verify mothdex-mcp_0.1.0.mjs  # same flags
   gh attestation verify mothdex-mcp_0.1.0.mcpb  # same flags
   cmp mothdex-mcp_0.1.0.mjs <(git show v0.1.0:dist/mothdex-mcp.mjs)   # in a clone: asset == committed dist
   cmp <(unzip -p mothdex-mcp_0.1.0.mcpb dist/mothdex-mcp.mjs) mothdex-mcp_0.1.0.mjs   # the bundle inside the .mcpb is the asset
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

## Planned: publishing to npm and to the MCP registry (design only, not implemented)

Status: **design for the threat model (Sentinela) before any code**. Nothing in this section runs today: `package.json` stays
`private: true`, no workflow publishes anywhere, there is no npm login and no token. Phase B of T-82 implements it after the
review. Owner decisions it rests on: D28 6b (the npm package name is the unscoped `mothdex-mcp`), D28 3 (no tag until the planned
scope is finished), D28 1c (the owner identity, no bot).

### Principles

- The npm tarball and the registry entry are made from the **same attested files** as the GitHub release, never rebuilt in the
  publishing jobs.
- No long-lived secret: npm publishes by trusted publishing (OIDC), the registry by GitHub OIDC login.
- Each publishing job has `id-token: write` **only in that job**, the environment `release` (required reviewer), a read-only
  `contents`, and runs only after `build`, `attest` and `publish` succeeded, on the tag's own commit.
- The first publish of a name cannot use a trusted publisher (the package must exist first): see the owner list.

### Job `npm` (after `publish`)

1. Download the `release-files` artifact; `sha256sum --check --strict checksums.txt`; `gh attestation verify` for every listed
   file with the same flags as `publish` (signer workflow, tag, `--source-digest`, no self-hosted runner).
2. The tarball: `build` already ran `npm pack --ignore-scripts` on the clean tree and listed `mothdex-mcp-<version>.tgz` in
   `checksums.txt` (so it is attested like the other files). This job checks that `dist/mothdex-mcp.mjs` inside it has the same
   SHA-256 as the attested `mothdex-mcp_<version>.mjs`, that `package.json` in it says `private: false`, the tag's version and
   the expected `mcpName`, and that its file list is exactly the four files `scripts/check-package.mjs` allows.
3. npm CLI **>= 11.5.1** (trusted publishing needs it): install a pinned version from a checksum-verified source, never "latest".
4. `npm publish ./mothdex-mcp-<version>.tgz --provenance --access public` with no token in the environment; npm exchanges the
   job's OIDC token for a publish credential. The tarball path is published as it is: no repack.
5. After publishing: `npm view mothdex-mcp@<version> dist.integrity` must equal the SHA-512 integrity computed from the verified
   tarball, and in an empty directory `npm install mothdex-mcp@<version> --ignore-scripts` followed by `npm audit signatures`
   must pass (registry signature and provenance of that exact version).
6. A failure after step 4 is not retried by publishing again (a version is immutable): the run stops, the owner decides
   (deprecate and release a patch version).

### Job `registry` (after `npm`)

1. The same download, checksum and attestation verification.
2. Generate the `mcpb` package entry of `server.json` at release time (the committed `server.json` keeps only the npm entry):
   `registryType: "mcpb"`, `identifier` = the GitHub release URL of `mothdex-mcp_<version>.mcpb` for this tag, `fileSha256` = its
   line in the verified `checksums.txt`, `version` = the tag's. The hash cannot be committed beforehand, which is why it is generated.
3. `mcp-publisher`, a **pinned version** whose release asset is verified before it runs: SHA-256 pinned in the repository and the
   Sigstore bundle of that release verified with the pinned cosign identity (whether upstream publishes a bundle for it is
   to be checked in phase B; if it does not, the pinned SHA-256 alone is the check and this is stated, not hidden).
4. `mcp-publisher validate` on the generated file, then `mcp-publisher login github-oidc` and `mcp-publisher publish`. The name
   `io.github.Or4cu1o/mothdex-mcp` is authenticated by the GitHub identity of the repository owner.
5. The `.mcpb` URL must keep working for as long as the entry lists it: releases are never deleted (immutable releases on).

### What the owner must configure (nothing is done by this repository)

For **phase A** (already in the pull request): accept or refuse the single pnpm exception `undici-types@6.21.0` in
`tools/mcpb/pnpm-workspace.yaml`; nothing else, no new required check name.

For **phase B**, in this order, only when the owner decides to publish:

1. An npm account (owner identity, two-factor authentication on, `auth-and-writes`) and the name `mothdex-mcp` free (D28 6b).
2. The first publish of the name, by the owner, by hand and with a short-lived granular token that is revoked right after
   (T-60 SC-01); then, on the package page, a **trusted publisher**: repository `Or4cu1o/mothdex-mcp`, workflow `release.yml`,
   environment `release`.
3. Package settings: require two-factor authentication and **disallow tokens** once the trusted publisher works.
4. The GitHub environment `release` already exists (required reviewer, tags `v*`): no change, but it now gates three jobs, so the
   reviewer approves each one.
5. The release pull request flips `private` to `false` and bumps the versions (T-66 item 5); until then `npm publish` is refused
   by npm itself, which is the intended gate.
6. Nothing to configure for the MCP registry beyond the GitHub identity; the namespace `io.github.Or4cu1o` follows from it.

### Residuals to judge in the threat model

- A compromised release workflow could publish anything under the trusted publisher: the tag ruleset, the environment reviewer
  and the verification of attested files are the controls; the registry and npm only see what the workflow sends.
- npm and the registry are third parties; `npm audit signatures` and the attestation verify what was published, not that it
  stays available.
- `mcp-publisher` runs with an OIDC token in the job: its provenance is the pinned checksum (and the bundle, if it exists).
