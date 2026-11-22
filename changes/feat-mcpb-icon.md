### Added

- T-85: the `.mcpb` now carries its icon: `mcpb/icon.png` (512x512, the project-owned art approved in D30), referenced by `mcpb/manifest.json` as `icon`. `scripts/pack-mcpb.sh` stages it, expects exactly three members (`manifest.json`, `icon.png`, `dist/mothdex-mcp.mjs`),
  compares each byte for byte with the committed file and checks the PNG header (512x512); `mcpb validate` passes with the icon. `scripts/check-package.mjs` checks the manifest reference and the PNG too. `docs/release.md` and `plugin.md` 5.3 give the new list,
  and plugin.md 5.3 says a pre-release tag is a GitHub pre-release only (the npm and registry jobs are skipped for it).
