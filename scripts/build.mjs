import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/mothdex-mcp.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // npm links `bin` as it is: without this line `npx mothdex-mcp` runs the file as a shell script.
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: false,
  logLevel: "info",
});
