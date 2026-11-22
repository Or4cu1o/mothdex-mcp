# Release process and verification

The release is a tag. Nothing here runs until the owner creates a `v*` tag; no workflow publishes from a branch.

## What a release contains

- `mothdex-mcp_<version>.mjs`: the single-file server bundle. Byte for byte the same as the committed
  `dist/mothdex-mcp.mjs` at the tag (the build job fails otherwise).
- `mothdex-mcp_<version>.mcpb`: the MCP Bundle for clients that install `.mcpb` files. It holds exactly two files, the
  `manifest.json` (`mcpb/manifest.json`) and `dist/mothdex-mcp.mjs`, both byte for byte the committed ones. There is no icon
  yet (backlog `mcpb-icon`, after the brand session); the list check in `scripts/pack-mcpb.sh` says so and changes when it lands.
  The container is **not reproducible**: `mcpb pack` stamps the time of packing in the zip, so two packs of the same files differ. Integrity rests on
  the attestation of the packed file and on the byte-for-byte check of its two members against the committed files.
- `mothdex-mcp-<version>.tgz`: the npm tarball, made once in the build job (`npm pack --ignore-scripts`) and published to npm by the
  `npm` job as it is. `server.json`: the committed MCP registry file, which the `registry` job extends with the `.mcpb` entry.
- `checksums.txt` (SHA-256 of all four files), and a GitHub build-provenance attestation for each of them and for `checksums.txt`.

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
- After `publish`, the `npm` job (environment `release`) and then the `registry` job (environment `mcp-registry`) run, as
  described in the section on publishing below.
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

## Publishing to npm and to the MCP registry (implemented in `release.yml`, dormant)

Status: implemented as designed by Sentinela's threat model (constraints MP-1 to MP-13, owner settings O-1 to O-8) and **never run
on a tag**. It is dormant: `package.json` says `private: true`, so the `npm` job refuses the tarball (and npm itself would), and
the jobs need the environments and the trusted publisher the owner has not configured yet. There is no npm login and no token.
A job that cannot run without a tag is checked statically: `actionlint` (shellcheck inside), and the CI step
`scripts/exercise-release-steps.py --with-publisher`, which runs the real `run:` text of the tarball-rules step and of the
`server.json` step against files built from the tree (positive and negative cases), fetches the pinned `mcp-publisher` through
the registry job's own step (hash and Sigstore bundle verified) and runs `mcp-publisher validate` on the generated file. What
stays unverified until the first tag: `gh attestation verify` in these jobs, npm trusted publishing and `--provenance`,
`npm audit signatures`, `mcp-publisher login github-oidc` and `publish`, and the shape of npm's provenance endpoint (a
different shape is a warning, a different workflow or ref is a failure). Owner decisions it rests on: D28 6b (the npm package
name is the unscoped `mothdex-mcp`), D28 3 (no tag until the planned scope is finished), D28 1c (the owner identity, no bot).

### Principles

- The npm tarball and the registry entry are made from the **same attested files** as the GitHub release, never rebuilt in the
  publishing jobs. The tarball (`mothdex-mcp-<version>.tgz`, from `npm pack --ignore-scripts` on the clean tree in `build`) is
  listed in `checksums.txt`, so it is attested like the other files.
- No long-lived secret: npm publishes by trusted publishing (OIDC), the registry by GitHub OIDC login.
- `id-token: write` appears only on `attest` (no environment), `npm` (environment `release`) and `registry` (its own environment
  `mcp-registry`). Any job with `id-token` can mint tokens for any audience, so the registry job, which runs a third-party tool, must
  sit in an environment that npm does not trust (MP-1, MP-2).
- The two publishing jobs have **no checkout**: they work only on the downloaded artifact in a fresh directory, so a merged
  `.npmrc` or script cannot reach them (MP-3). Neither gets `contents: write`, `packages` or `attestations: write`, and neither
  passes `GITHUB_TOKEN` to npm or `mcp-publisher` (MP-9).
- `release.yml` keeps `on: push: tags: ["v*"]` as its only trigger; `npm` and `registry` need `build`, `attest` and `publish` and repeat
  the tag-to-commit check of `publish` before any token is used (MP-5).

### Job `npm` (after `publish`; environment `release`)

1. Download the `release-files` artifact; `sha256sum --check --strict checksums.txt`; `gh attestation verify` for every listed file
   with the same flags as `publish`; the tag-to-commit check.
2. Every npm call runs with `NPM_CONFIG_USERCONFIG` and `NPM_CONFIG_GLOBALCONFIG` pointing at an empty file the job creates,
   `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/` and `--registry https://registry.npmjs.org/`; any other `NPM_CONFIG_*` or
   `npm_config_*` variable in the environment fails the job (MP-3).
3. The npm CLI is >= 11.5.1: the npm bundled with an **exact** Node version pinned in the workflow, with `npm --version` asserted
   equal to the expected `11.x.y`; if that npm is too old, the npm tarball of a pinned version whose SHA-512 integrity is pinned in
   the repository and checked before extraction, run as `node <dir>/bin/npm-cli.js`. Never `npm install -g npm@latest`, never `npx`
   (MP-6).
4. Inside the tarball (read with `tar`, never extracted into a path npm reads): `private: false`, the tag's version, the expected
   `mcpName` and `bin`, no lifecycle `scripts`, no `dependencies`, `optionalDependencies`, `peerDependencies` or `bundleDependencies`,
   exactly the four files `scripts/check-package.mjs` allows, and the SHA-256 of `dist/mothdex-mcp.mjs` equal to the attested `.mjs`.
5. In the same step as the publish, the tarball's SHA-256 is compared once more with its `checksums.txt` line, then
   `npm publish <path-to-the-tgz> --provenance --access public --ignore-scripts` with no token in the environment. There is no
   `npm pack` and no `npm publish .` in this job (MP-4).
6. Before publishing, `npm view mothdex-mcp@<version>`: if the version exists, only the checks of step 7 run (a re-run must not
   publish again). There is no retry around the publish (MP-11).
7. After publishing, with the same config: `npm view mothdex-mcp@<version> dist.integrity` equals the SHA-512 of the verified
   tarball; in an empty directory `npm install mothdex-mcp@<version> --ignore-scripts` followed by `npm audit signatures` passes; the
   provenance attestation of that version names repository `Or4cu1o/mothdex-mcp`, workflow `release.yml` and ref
   `refs/tags/<tag>` when npm exposes a stable way to read it (MP-12).
8. A failure after the publish is not retried by publishing again (a version is immutable): the run stops and the owner decides
   (deprecate and release a patch version).

### Job `registry` (after `npm`; environment `mcp-registry`)

1. The same download, checksum, attestation and tag checks. Permissions: `contents: read`, `attestations: read`, `id-token: write`.
2. `server.json` for the registry is generated with `jq --arg` (never string concatenation) from the tag (already semver-checked), the
   fixed repository `Or4cu1o/mothdex-mcp` and the `.mcpb` line of the verified `checksums.txt` (64 lower-case hex
   characters): `registryType: "mcpb"`, `identifier` exactly `https://github.com/Or4cu1o/mothdex-mcp/releases/download/<tag>/mothdex-mcp_<version>.mcpb`,
   `fileSha256` that hash, `version` the tag's, and the `name` equal to `package.json` `mcpName`; the npm entry's version is checked against `npm view` of
   the version just published. The committed `server.json` keeps only the npm entry (MP-7).
3. `mcp-publisher` is a pinned version downloaded by its exact release URL into a fresh directory; its SHA-256 is pinned in the
   repository and checked before `chmod +x`. If upstream publishes a Sigstore bundle or a GitHub attestation it is verified with
   the pinned signer identity; if not, this document says that the pinned hash is the only check (trust on first use, as for
   the SDL2.dll of mothdex-cli). Never taken from PATH, a cache or `go install @latest` (MP-8).
4. `mcp-publisher validate` must pass before `mcp-publisher login github-oidc` and `mcp-publisher publish`. No retry (MP-7, MP-11).
5. The `.mcpb` URL must keep working for as long as the entry lists it: releases are never deleted (immutable releases on).
6. Order and visibility: GitHub release, then `npm`, then `registry`, each needing the previous one; the job summaries print the
   published integrity, the `server.json` that was sent and the registry's answer, so the owner can check them before announcing (MP-13).

### What the owner must configure (nothing is done by this repository)

For **phase A** (already in the pull request): accept or refuse the single pnpm exception `undici-types@6.21.0` in
`tools/mcpb/pnpm-workspace.yaml`; nothing else, no new required check name.

For **phase B**, only when the owner decides to publish (O-1 to O-8 of the threat model):

1. **O-1:** an npm account with two-factor authentication for authentication and writes, the owner identity (D28 1c), and the name
   `mothdex-mcp` free (D28 6b).
2. **O-2 (MP-10):** the first publish of the name by the owner, by hand, of the attested `.tgz` of the first GitHub release,
   downloaded and verified with `sha256sum` and `gh attestation verify` in an empty directory, with a granular token scoped to
   `mothdex-mcp` only and the shortest expiry, deleted the same day. If npm allows a trusted publisher before the first version
   (not verified), this token step is dropped. A placeholder version is not recommended: it would be the one version without
   provenance.
3. **O-3:** on the package, a **trusted publisher**: repository `Or4cu1o/mothdex-mcp`, workflow `release.yml`, **environment `release`**;
   then "Require two-factor authentication and disallow tokens".
4. **O-4:** GitHub environment `release`: required reviewer (the owner), deployment policy **selected tags `v*` only** (no
   branches), "Allow administrators to bypass" off. It now gates `publish` and `npm`, so the reviewer approves each job.
5. **O-5:** a **new** GitHub environment `mcp-registry` with the same settings; npm does not trust it.
6. **O-6:** a tag ruleset for `v*` (creation only by the owner, update and deletion blocked), immutable releases on, default
   `GITHUB_TOKEN` permissions read-only, the allowed-actions list as today, and no secret named like `NPM_TOKEN` at repository,
   environment or organization level.
7. **O-7:** `main` requires the checks including `dist == build(src)` and a review on `.github/workflows/`, `package.json` and any
   `.npmrc` (CODEOWNERS, as recommended for mothdex-cli; with one identity it needs the owner's decision, see PR-78).
8. **O-8:** how the registry scopes a `github-oidc` login (the repository or the owner namespace) is to be checked in phase B; if it
   is the namespace, no other repository of `Or4cu1o` should run `mcp-publisher`, or the owner accepts the residual.
9. The release pull request flips `private` to `false` and bumps the versions (T-66 item 5); until then `npm publish` is refused by
   npm itself, which is the intended gate.

### Residuals

- Provenance and signatures prove where a version came from, not that its dependencies were benign: the controls stay the lockfile,
  `--ignore-scripts`, `dist == build(src)` and the reviews.
- The registry namespace may be owner-wide (see O-8).
- With one person (D28 1c) a stolen owner session can tag and approve; the tag ruleset, the tag-to-commit check and the attestation
  checks limit what it can do outside the workflow, not inside it.
- npm and the MCP registry are third parties and the MCP registry is in preview: the checks verify what was published, not its
  availability, and its data can be reset.
- `mcp-publisher` may be trust on first use (MP-8).
