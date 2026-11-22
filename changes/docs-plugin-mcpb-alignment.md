### Changed

- T-82: `plugin.md` §5.3 follows phase A and the T-82 threat model: the `.mcpb` holds exactly the manifest and the bundle
  until the icon exists; `id-token: write` sits on `attest`, `npm` and `registry` with separate environments (MP-1, MP-2);
  `mcp-publisher` is checked by its pinned hash, and by a signature when upstream publishes one (MP-8).
