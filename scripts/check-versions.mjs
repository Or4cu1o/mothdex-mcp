// Fails when the plugin manifest and package.json disagree on the version (plugin.md section 3).
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const versions = {
  "package.json": read("package.json").version,
  ".claude-plugin/plugin.json": read(".claude-plugin/plugin.json").version,
};

if (new Set(Object.values(versions)).size !== 1) {
  console.error(`version mismatch: ${JSON.stringify(versions)}`);
  process.exit(1);
}
console.log(`versions agree: ${versions["package.json"]}`);
