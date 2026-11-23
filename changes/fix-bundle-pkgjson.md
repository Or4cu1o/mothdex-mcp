### Fixed

- T-103: the bundle embeds only the `name` and `version` of `package.json` (an esbuild plugin in `scripts/build.mjs`), no longer its `scripts` and `devDependencies`; `check:package` fails if they come back. `dist` rebuilt. The icon check exercise gains the height-256 and shorter-than-24-bytes cases.
