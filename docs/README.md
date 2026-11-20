# Documentation

Design contracts are the source of truth that code in this repository follows. A change to a contract is announced
before it lands, and code that deviates from one is a bug in either the code or the contract.

| Folder | Content |
|---|---|
| [`contracts/mcp/`](contracts/mcp/) | [tools, resources and prompts](contracts/mcp/tools.md), [Claude Code plugin packaging](contracts/mcp/plugin.md) |
| [`adr/`](adr/) | [ADR-0001 stack](adr/ADR-0001-stack.md) (copy; the canonical ADRs live in mothdex-cli) |
| [`research/`](research/) | T1c Claude Code plugin spec, T1d MCP TypeScript SDK, MCPB and registry |

The API client rules, error codes and fixtures shared with this server are defined in
[mothdex-cli](https://github.com/Or4cu1o/mothdex-cli/tree/main/docs/contracts/cli); fixtures are copied from
`pkg/mothdex/testdata/api-v1/` there.

## Planning references

These documents were written during the project's planning phase. Short references in them point to that plan,
which is not part of this repository:

- **PLAN §n**: section *n* of the internal plan v0 (2026-11-20). The decisions that matter here are recorded in the ADRs.
- **A1–A7**: findings from reading the upstream code:
  A1 the proxy ignores `Range` (no resume, no segments); A2 the proxy fetches files on demand via BitTorrent and may
  stall up to 15 min per piece; A3 a proxy `404` can be transient; A4 the API exposes no file hashes;
  A5 API rate limit of 30 req/s plus a meta-limit of 15 breaches per hour; A6 some errors are HTTP `200` with
  `info.error`; A7 the CrocDB → Mothdex v1 field and endpoint changes.
- **D1–D5**: owner decisions (D1 Go CLI + TypeScript MCP, see ADR-0001; D5 contribute hashes and `Range` upstream).
- **T-n, E-…, U1–U5, OQ-…**: task, epic, upstream-proposal and open-question ids from the project roadmap.
- **T1x research**: Sonda's research notes in [`research/`](research/); each claim carries a source and a check date.
