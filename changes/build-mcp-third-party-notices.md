### Fixed

- The licence notices of the packages built into the server (`zod`, MIT, and the MCP SDK packages, Apache-2.0) now ship with it: `dist/THIRD_PARTY_NOTICES.txt` is in the npm package, in the `.mcpb` file and in the plugin folder. It is generated from the exact list of packages in the bundle at build time, and the checks fail if one of them has no licence in it.
