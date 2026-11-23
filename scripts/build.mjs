import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

// `src` reads package.json for the version. Bundled as is, the file would drag `scripts`, `devDependencies` and the rest
// into the published bundle: embed only these two fields.
const embedNameAndVersion = {
  name: "embed-package-json-name-and-version",
  setup(b) {
    b.onLoad({ filter: /[\\/]package\.json$/ }, (args) => {
      // Only the project's own file: a dependency's package.json is left alone.
      if (args.path !== resolve("package.json")) return undefined;
      const { name, version } = JSON.parse(readFileSync(args.path, "utf8"));
      return { contents: JSON.stringify({ name, version }), loader: "json" };
    });
  },
};

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
  plugins: [embedNameAndVersion],
  logLevel: "info",
});
