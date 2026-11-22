### Added

- T-82 phase A: the release also builds a `.mcpb` (MCP Bundle) of the committed bundle, packed and validated with the pinned `@anthropic-ai/mcpb` (own project and frozen lockfile in `tools/mcpb`, install scripts off),
  checked to hold exactly the manifest and the bundle (byte for byte the committed files, smoke test of the bundle inside it), listed in `checksums.txt`, attested like the other release file and uploaded with
  the release. `pnpm check:package` runs in the release build too, and `scripts/pack-mcpb.sh` runs in the existing `dist == build(src)` CI job, so no new check name. `docs/release.md` gains the design of the npm and
  MCP registry publishing (not implemented) and the list of what the owner must configure.
