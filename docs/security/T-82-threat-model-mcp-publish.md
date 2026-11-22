# T-82: Threat model, npm publish and MCP registry jobs of `mothdex-mcp`

Status: v1 · Author: Sentinela · Date: 2026-11-22 · Risk: **High** (supply chain, publishing) · Consumer: Guindaste (T-82 phase B)
Input: the "Planned: publishing to npm and to the MCP registry" section of `docs/release.md` at PR #28 head `ed889e8`, the
`release.yml` there, and T-60 SC-01 to SC-08. Owner decisions: D28 6b (unscoped `mothdex-mcp`), D28 1c (owner identity,
no bot), D28 3 (no tag before the scope is done).
Gate: phase B is coded against §4. Each constraint is either met or rejected by Regente.

## 0. Scope, method, limits

**In scope:** only the two planned jobs, `npm` and `registry`:
- OIDC trusted publishing and the reach of `id-token`;
- environment protection;
- tarball identity between `attest` and `npm publish`;
- provenance and `npm audit signatures`;
- `server.json` generation with the real `fileSha256`;
- the `mcp-publisher` pin and its verification, and `login github-oidc`;
- what an attacker who controls a PR, a dependency, a tool or the registry can do.

**Out of scope:** the phase A review (build, attest, publish of the GitHub release, `tools/mcpb`), which waits for the
owner decision on the pnpm exception. Also out of scope: the content of the bundle itself (T-60, the code reviews).

**Method:** STRIDE over the two jobs as designed, read against the existing `release.yml` (`permissions: {}`; `build`
read-only; `attest` with `id-token` and no environment; `publish` in `release`).

**Not verified:**
- npm's exact trusted-publisher matching rules (workflow path, environment, ref) beyond its documentation;
- whether a trusted publisher can be set before the first version exists;
- whether upstream `mcp-publisher` ships a Sigstore bundle or a GitHub attestation;
- how the registry scopes a `github-oidc` login (the repository, or the whole owner namespace);
- whether Node's bundled npm in the pinned Node is ≥ 11.5.1.

This document does not claim the design is free of vulnerabilities.

## 1. Key facts

- K1. An npm trusted publisher accepts an OIDC token from the named repository and workflow file and, **only if
  configured**, the named environment. Without an environment, **any job** of `release.yml` holding `id-token: write`
  can publish. Today that includes `attest`.
- K2. A job with `id-token: write` can mint GitHub OIDC tokens **for any audience**, and so can every process it runs.
  A tool in the registry job could therefore mint a token for `npm:registry.npmjs.org`. If that job runs in the
  environment npm trusts, the token publishes to npm.
- K3. npm reads `.npmrc` from the project directory, the user and the global config. A `registry=` line there sends
  the OIDC exchange, and the publish itself, to another host. That host receives a token npm accepts.
- K4. `npm publish <dir>` packs again and runs lifecycle scripts. `npm publish <file>.tgz` sends that file as it is.
- K5. A GitHub environment's deployment policy (branches and tags allowed) is what stops a branch or PR workflow from
  running a job in that environment. Required reviewers stop a run until someone approves it.
- K6. With D28 1c there is one human: the owner tags and also approves. "Prevent self-review" cannot be on, so the
  environment gate is a deliberate confirmation step, not a second person.
- K7. An npm version is immutable once published (an unpublish is limited and leaves the version burned). A registry
  entry can be republished.

## 2. Actors and boundaries

- **Actors:**
  - P1: an author of a PR merged to `main`, which can change `release.yml`, scripts, `package.json` or add `.npmrc`.
  - P2: a compromised dependency of the build (bundled into the dist).
  - P3: a compromised tool in the publish jobs (the npm CLI, `mcp-publisher`, an action).
  - P4: the npm registry or the MCP registry itself.
  - P5: a network attacker.
  - P6: another repository of the owner (same `io.github.Or4cu1o` namespace).
- **Boundaries:**
  - B1: the artifact `release-files` between jobs.
  - B2: the job's OIDC token to npm.
  - B3: the job's OIDC token to the registry.
  - B4: the generated `server.json`.

## 3. Threats

| Id | Threat | L | I | Control in the design | Status |
|---|---|---|---|---|---|
| PB-01 | The trusted publisher is configured without the environment, so `attest` (or any future job with `id-token`) can publish (K1) | Med | High | owner list item 2 names the environment | make it a hard requirement → MP-1, O-3 |
| PB-02 | A compromised `mcp-publisher` in the registry job mints an `npm:registry.npmjs.org` token and publishes a new npm version (K2) | Low | High | none: both jobs would sit in `release` | **design gap** → MP-2 |
| PB-03 | A merged `.npmrc` (or `NPM_CONFIG_*` env) redirects the registry, so the OIDC exchange and the tarball go to an attacker host that replays the token (K3) | Low | High | none | **design gap** → MP-3 |
| PB-04 | The published bytes differ from the attested ones: repack, publish from a directory, lifecycle script, file swapped between verify and publish (K4) | Low | High | publish the attested `.tgz` path, no repack | keep → MP-4 |
| PB-05 | A branch, PR or `workflow_dispatch` run reaches a publish job (P1 adds a trigger or a job) | Low | High | tag-only trigger, environment `release` | depends on the environment's tag policy → MP-5, O-4 |
| PB-06 | Unpinned npm CLI ("latest", or a pin without integrity) or `mcp-publisher` from PATH or cache (P3) | Med | High | "pinned version from a checksum-verified source" | make it concrete → MP-6, MP-8 |
| PB-07 | A malicious dependency bundled into the dist is published with valid provenance (P2) | Low | High | frozen lockfile, `--ignore-scripts`, `dist == build(src)`, reviews | residual R1: provenance proves origin, not innocence |
| PB-08 | `server.json` injection or mismatch: the tag or hash concatenated into JSON, a wrong URL or repo, `fileSha256` of another file, version drift, npm entry pointing at a version that did not publish (B4) | Low | High | generated from the verified `checksums.txt` | → MP-7 |
| PB-09 | `mcp-publisher` gets more than it needs: `contents: write`, `attestations: write`, the npm token, the GitHub token | Low | Med | not stated | → MP-2, MP-9 |
| PB-10 | Another repository of the owner (P6) publishes or overwrites `io.github.Or4cu1o/mothdex-mcp` through its own `github-oidc` login, if the registry scopes the login to the owner namespace (not verified) | Low | High | none possible from this repository | residual R2, owner note O-8 |
| PB-11 | The first publish of the name, done by hand with a token: a token left alive, or a version without provenance that does not equal an attested file (SC-01) | Med | High | short-lived granular token, revoked | → MP-10, O-2 |
| PB-12 | A partial run: npm published, the registry failed; or a re-run publishes again (K7) | Med | Low | no retry after publish | keep; → MP-11 |
| PB-13 | The post-publish checks run against a redirected registry or a cached package, so they verify nothing (K3) | Low | Med | `npm view`, `npm audit signatures` | → MP-3, MP-12 |
| PB-14 | The single-person gate (K6): the owner approves a run started by a stolen owner session or a moved tag | Low | High | tag ruleset, tag-to-commit check, attestation with `--source-digest` | residual R3 |

## 4. Constraints for phase B (Guindaste)

Severity follows risk-process: on this High item, every Minor is required unless Regente rejects it.

| Id | Sev | Constraint |
|---|---|---|
| MP-1 | Major | The npm trusted publisher names repository `Or4cu1o/mothdex-mcp`, workflow `release.yml` and environment `release`. In `release.yml`, `id-token: write` appears only on `attest` (no environment), on `npm` (environment `release`) and on `registry` (its own environment, MP-2). No other job gets `id-token` in environment `release`. |
| MP-2 | Major | The `registry` job runs in a **separate environment** (`mcp-registry`: required reviewer, tags `v*` only) that npm does not trust, so tokens minted there cannot publish to npm. It has `contents: read`, `attestations: read` and `id-token: write`, and nothing else. |
| MP-3 | Major | No checkout in `npm` or `registry`: they work only on the downloaded artifact in a fresh directory. Every npm call (publish, view, install, audit signatures) runs with `NPM_CONFIG_USERCONFIG` and `NPM_CONFIG_GLOBALCONFIG` pointing to an empty file the job creates, `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/`, and `--registry https://registry.npmjs.org/` on the command line. Any other `NPM_CONFIG_*` or `npm_config_*` in the environment fails the job. |
| MP-4 | Minor | The job publishes the verified `mothdex-mcp-<version>.tgz` by file path, with `npm publish <path> --provenance --access public --ignore-scripts`. Directly before the publish, in the same step, the file's SHA-256 is compared again with its `checksums.txt` line. There is no `npm pack` and no `npm publish .` in these jobs. Inside the tarball (read with `tar`, never extracted into a path npm reads), the job checks: `private: false`, the tag's version, the expected `mcpName` and `bin`, no `scripts` with lifecycle names, no `dependencies`, `optionalDependencies`, `peerDependencies` or `bundleDependencies`, the four allowed files, and the dist SHA-256 equal to the attested `.mjs`. |
| MP-5 | Minor | `release.yml` keeps `on: push: tags: ["v*"]` as its only trigger, and the `npm` and `registry` jobs `needs:` `build`, `attest` and `publish`. They also repeat the tag-to-commit check of `publish` before any token is used. Reviewers check, by review, that no PR adds a trigger or a job; the environment tag policy (O-4) is the control that holds if one slips through. |
| MP-6 | Minor | The npm CLI comes from one of two sources. The first is the npm bundled with an **exact** Node version pinned in the workflow; the job asserts `npm --version` equals the expected `11.x.y` (≥ 11.5.1). The second, if that npm is too old, is the npm tarball of a pinned version, downloaded from the registry URL with its SHA-512 `integrity` pinned in the repository, checked before it is extracted, and run as `node <dir>/bin/npm-cli.js`. Never `npm install -g npm@latest` or `npx`. |
| MP-7 | Minor | `server.json` is generated with `jq --arg` (never string concatenation) from: the tag (already semver-checked), the fixed repository `Or4cu1o/mothdex-mcp`, and the `.mcpb` line of the verified `checksums.txt` (64 lower-case hex characters). The `identifier` is exactly `https://github.com/Or4cu1o/mothdex-mcp/releases/download/<tag>/mothdex-mcp_<version>.mcpb`. The npm entry's version equals the tag and is checked against `npm view` of the version just published. The `name` equals `package.json` `mcpName`. `mcp-publisher validate` must pass before login. |
| MP-8 | Minor | `mcp-publisher` is a pinned version downloaded by exact release URL into a fresh directory. Its SHA-256 is pinned in the repository and checked before `chmod +x`. If upstream publishes a Sigstore bundle or a GitHub attestation, it is verified with the pinned signer identity (repository and workflow of `modelcontextprotocol/registry`). If not, the docs state that the pinned hash is the only check (trust on first use, as for `SDL2.dll`). It is never taken from PATH, a cache or `go install @latest`. |
| MP-9 | Minor | Neither job gets `contents: write`, `packages` or `attestations: write`, and none passes `GITHUB_TOKEN` to `mcp-publisher` or npm. `persist-credentials` is irrelevant (no checkout), and no secret is referenced. |
| MP-10 | Minor | The first publish (owner, by hand) uses the attested `.tgz` of the first GitHub release, downloaded and verified with `sha256sum` and `gh attestation verify` (the docs/release.md flags) in an empty directory. It is published with a granular token scoped to `mothdex-mcp` only, read and write, the shortest expiry, deleted right after. Then the trusted publisher is configured and tokens are disallowed (O-3). If npm allows a trusted publisher before the first version (not verified), the token step is dropped. A placeholder version is not recommended: it would be the one version without provenance. |
| MP-11 | Minor | No retry around `npm publish` or `mcp-publisher publish`. Re-running a job after a publish must fail safely: the npm job first checks `npm view mothdex-mcp@<version>`, and if the version exists it only runs the MP-12 checks. Recovery is a new patch version (docs/release.md rollback). |
| MP-12 | Minor | After publishing, with the MP-3 config:
- `npm view mothdex-mcp@<version> dist.integrity` equals the SHA-512 of the verified tarball;
- in an empty directory, `npm install mothdex-mcp@<version> --ignore-scripts` then `npm audit signatures` passes;
- the npm provenance attestation of that version names repository `Or4cu1o/mothdex-mcp`, workflow `release.yml` and ref `refs/tags/<tag>`, read from the registry's attestations endpoint (Suggestion if npm exposes no stable way). |
| MP-13 | Suggestion | Order and visibility: GitHub release → `npm` → `registry`, each needing the previous one. The job summary prints the published integrity, the `server.json` it sent, and the registry's answer, so the owner checks them before announcing. |

## 5. GitHub and npm settings the owner must configure (OWNER OK)

| Id | Where | Setting |
|---|---|---|
| O-1 | npm | Account with two-factor authentication for auth and writes; the owner identity (D28 1c). |
| O-2 | npm | First publish as in MP-10, then delete the granular token the same day. |
| O-3 | npm, package `mothdex-mcp` | Trusted publisher: repository `Or4cu1o/mothdex-mcp`, workflow `release.yml`, **environment `release`** (MP-1). Then "Require two-factor authentication and disallow tokens". |
| O-4 | GitHub, environment `release` | Required reviewer (owner); deployment policy **selected tags `v*` only** (no branches); "Allow administrators to bypass" off. |
| O-5 | GitHub, new environment `mcp-registry` | Same as O-4 (MP-2). Not trusted by npm. |
| O-6 | GitHub, repository | Tag ruleset for `v*` (creation by the owner only, update and deletion blocked), immutable releases on, default `GITHUB_TOKEN` permissions read-only, allowed-actions list as today. No secret named like `NPM_TOKEN` at repository, environment or organization level. |
| O-7 | GitHub, branch `main` | Required checks including `dist == build(src)` (the only control on the bundle content, docs/release.md); required review on `.github/workflows/`, `package.json` and any `.npmrc` (CODEOWNERS, as recommended for mothdex-cli in PR-78). |
| O-8 | GitHub, other repositories of the owner | If the registry scopes `github-oidc` to the owner namespace (PB-10, to be checked in phase B), no other repository of `Or4cu1o` should run `mcp-publisher`, or the owner accepts R2. |

## 6. Residual risk

- R1: provenance and signatures prove where a version came from, not that its dependencies were benign (PB-07). The
  controls stay the lockfile, reviews and the audit job.
- R2: the registry namespace may be owner-wide (PB-10). A weaker repository of the same owner could then publish this
  entry.
- R3: with one person (K6), a stolen owner session can tag and approve. The tag ruleset, the attestation checks and
  the npm 2FA on the account limit what such a session can do outside the workflow, but not inside it.
- R4: npm and the MCP registry are third parties. The checks verify what was published, not its availability. The
  MCP registry is in preview, so its data can be reset.
- R5: `mcp-publisher` may be trust on first use (MP-8).
