// Checks what `npm publish` would ship and the registry metadata (plugin.md section 5.2, T-60 CR-15, SC-02, SC-06).
// Never publishes: `npm pack --dry-run` only lists the files. Run after `pnpm build`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const server = read("server.json");
const problems = [];

if (pkg.dependencies !== undefined && Object.keys(pkg.dependencies).length > 0) {
  problems.push("package.json has runtime dependencies: the bundle must be self-contained");
}
const LIFECYCLE = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "prepack",
  "postpack",
  "publish",
  "postpublish",
];
for (const name of LIFECYCLE) {
  if (pkg.scripts?.[name] !== undefined)
    problems.push(`package.json has the lifecycle script "${name}"`);
}
if (pkg.mcpName !== server.name)
  problems.push(`mcpName ${pkg.mcpName} differs from server.json name ${server.name}`);
const npmEntry = server.packages?.find((p) => p.registryType === "npm");
if (npmEntry?.identifier !== pkg.name)
  problems.push(
    `server.json npm identifier ${npmEntry?.identifier} differs from package name ${pkg.name}`,
  );
if (JSON.stringify(pkg.bin) !== JSON.stringify({ "mothdex-mcp": "dist/mothdex-mcp.mjs" }))
  problems.push("bin must be exactly mothdex-mcp -> dist/mothdex-mcp.mjs");
if (pkg.publishConfig?.provenance !== true || pkg.publishConfig?.access !== "public")
  problems.push("publishConfig must set provenance true and access public");
for (const entry of server.packages ?? []) {
  const vars = Object.fromEntries((entry.environmentVariables ?? []).map((v) => [v.name, v]));
  for (const [name, v] of Object.entries(vars)) {
    if (v.default !== undefined || v.value !== undefined)
      problems.push(`server.json ${name} must have no default or value`);
  }
}
const mcpb = read("mcpb/manifest.json");
if (mcpb.user_config?.download_dir?.default !== undefined)
  problems.push("mcpb download_dir must have no default");

const WANT = ["LICENSE", "README.md", "dist/mothdex-mcp.mjs", "package.json"];
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" }),
)[0];
const have = packed.files.map((f) => f.path).sort();
if (JSON.stringify(have) !== JSON.stringify(WANT))
  problems.push(`npm pack lists ${JSON.stringify(have)}, want ${JSON.stringify(WANT)}`);
console.log(
  `dist sha256 ${createHash("sha256")
    .update(readFileSync(new URL("../dist/mothdex-mcp.mjs", import.meta.url)))
    .digest("hex")}`,
);

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`package ok: ${have.join(", ")}`);
