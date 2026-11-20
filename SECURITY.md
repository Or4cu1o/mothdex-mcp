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
