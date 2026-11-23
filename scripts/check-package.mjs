// Checks what `npm publish` would ship and the registry metadata (plugin.md section 5.2, T-60 CR-15, SC-02, SC-06).
// Never publishes: `npm pack --dry-run` only lists the files. Run after `pnpm build`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { iconProblems } from "./check-icon.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const server = read("server.json");
const problems = [];

for (const field of [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundleDependencies",
  "bundledDependencies",
]) {
  const value = pkg[field];
  if (value !== undefined && Object.keys(value).length > 0) {
    problems.push(`package.json has ${field}: the bundle must be self-contained`);
  }
}
// The release PR flips this one line on purpose, together with the version bump and the changelog fold: private may be
// false only when CHANGELOG.md has the section of this very version (so the tag build and the release PR both pass,
// and a flip that is not a release is refused).
if (pkg.private !== true) {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const heading = new RegExp(`^## \\[${pkg.version.replace(/[.+-]/g, "\\$&")}\\]`, "m");
  if (pkg.private !== false || !heading.test(changelog))
    problems.push(
      "package.json private may be false only in the release PR: CHANGELOG.md must have the section of this version",
    );
}
const dist = readFileSync(new URL("../dist/mothdex-mcp.mjs", import.meta.url));
if (!dist.toString("utf8", 0, 32).startsWith("#!/usr/bin/env node\n")) {
  problems.push("dist/mothdex-mcp.mjs must start with the node shebang (npm links bin as it is)");
}
const LIFECYCLE = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "preprepare",
  "postprepare",
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
if (mcpb.icon !== "icon.png")
  problems.push('mcpb/manifest.json must reference the icon as "icon.png"');
problems.push(...iconProblems(fileURLToPath(new URL("../mcpb/icon.png", import.meta.url))));

const WANT = [
  "LICENSE",
  "README.md",
  "dist/THIRD_PARTY_NOTICES.txt",
  "dist/mothdex-mcp.mjs",
  "package.json",
];
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  }),
)[0];
const have = packed.files.map((f) => f.path).sort();
if (JSON.stringify(have) !== JSON.stringify(WANT))
  problems.push(`npm pack lists ${JSON.stringify(have)}, want ${JSON.stringify(WANT)}`);
// The bundle starts as a program and answers --version (the smoke test covers the protocol).
const distPath = fileURLToPath(new URL("../dist/mothdex-mcp.mjs", import.meta.url));
const printed = execFileSync(process.execPath, [distPath, "--version"], {
  encoding: "utf8",
}).trim();
if (printed !== `mothdex-mcp ${pkg.version}`)
  problems.push(`dist --version printed "${printed}", want "mothdex-mcp ${pkg.version}"`);
// The bundle embeds only the name and the version of package.json, never `scripts` or `devDependencies`.
const bundled = readFileSync(distPath, "utf8");
if (/\bdevDependencies\b/.test(bundled))
  problems.push("dist embeds package.json devDependencies: only name and version may be bundled");
// Every package the bundle inlines has its licence in dist/THIRD_PARTY_NOTICES.txt (esbuild marks each module of the bundle
// with a `// node_modules/...` comment; the list is read from the bundle itself, not from the build script).
const inlined = new Set(
  [...bundled.matchAll(/^\/\/ node_modules\/.*$/gm)].flatMap(([line]) => {
    const names = [...line.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)\//g)];
    return names.length > 0 ? [names.at(-1)[1]] : [];
  }),
);
const notices = readFileSync(new URL("../dist/THIRD_PARTY_NOTICES.txt", import.meta.url), "utf8");
if (inlined.size === 0)
  problems.push("no inlined package found in the bundle: the notices check is blind");
for (const name of inlined) {
  const start = notices.indexOf(`\n${"=".repeat(78)}\n${name}@`);
  const section = start < 0 ? "" : notices.slice(start + 1).split(`\n${"=".repeat(78)}\n`)[0];
  if (!/^--- (licen[cs]e|copying)\S* ---$/im.test(section))
    problems.push(
      `${name} is inlined in the bundle but dist/THIRD_PARTY_NOTICES.txt has no licence for it`,
    );
}
console.log(`dist sha256 ${createHash("sha256").update(dist).digest("hex")}`);

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`package ok: ${have.join(", ")}`);
