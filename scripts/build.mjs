import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/mothdex-mcp.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: false,
  logLevel: "info",
});
