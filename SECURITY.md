# Security policy

## Supported versions

The project is pre-alpha and has no stable release. Fixes go to `main`.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub:
<https://github.com/Or4cu1o/mothdex-mcp/security/advisories/new>

Include the affected version or commit, what you observed and how to reproduce
it. You can expect an acknowledgement within 7 days. Fixes are coordinated with the
reporter and disclosed within 90 days of the report at the latest.

## Scope

Of particular interest: anything that lets an LLM or a remote response control
file paths or contents written to disk, handling of data returned by the API,
and the integrity of release artifacts (the bundle) and the CI pipeline.

## The download tool

`download_file` is opt-in (see the README) and its threat model is in
[docs/security/T-60-threat-model-download-file.md](docs/security/T-60-threat-model-download-file.md). Known limits: an
enabled tool relies on the client asking the user before each call; a project-scope `.mcp.json` in a cloned repository
can enable it or run any command, and the client's approval of that file is the boundary; a local attacker who can write
to the parent of the download folder can race the directory checks (Node has no `openat`); integrity is not authenticity; on Windows a signal handler cannot delete a staging file that is still open, so it stays
until the 24 h startup cleanup.

## Verifying releases

Each release attaches `mothdex-mcp_<version>.mjs` and `checksums.txt` with GitHub build-provenance attestations. The
commands, and what the pipeline checks before publishing, are in [docs/release.md](docs/release.md).
