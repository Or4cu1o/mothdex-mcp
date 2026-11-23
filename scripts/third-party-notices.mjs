// The licence notices of every package the bundle inlines. The package list comes from the esbuild metafile of the very
// build that wrote the bundle, so it cannot drift from the bundle; each package contributes its full licence text and its
// NOTICE file when it has one. A package with no licence file fails the build.
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.[a-z]+)?$/i;
const PACKAGE_IN_PATH = /node_modules\/((?:@[^/]+\/)?[^/]+)\//g;

/** Package roots (absolute, real paths) of every node_modules package that has a module in the bundle. */
export function inlinedPackageRoots(metafile, cwd) {
  const roots = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const input of Object.keys(output.inputs)) {
      const parts = [...input.matchAll(PACKAGE_IN_PATH)];
      const last = parts.at(-1);
      if (last === undefined) continue;
      roots.add(realpathSync(join(cwd, input.slice(0, last.index + last[0].length))));
    }
  }
  return [...roots];
}

/** The text file of notices: one section per package, sorted by name and version, with its licence files verbatim. */
export function buildNotices(metafile, cwd) {
  const packages = inlinedPackageRoots(metafile, cwd).map((root) => {
    const { name, version, license, repository } = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );
    const files = readdirSync(root)
      .filter((file) => LICENSE_FILE.test(file))
      .sort();
    if (!files.some((file) => !/^notice/i.test(file))) {
      throw new Error(`${name}@${version} is inlined in the bundle but has no licence file`);
    }
    return { name, version, license, repository, root, files };
  });
  packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"));
  const lines = [
    "Third-party notices for dist/mothdex-mcp.mjs",
    "",
    "The bundle includes the packages below. mothdex-mcp itself is GPL-3.0-only (see LICENSE).",
    "",
  ];
  for (const p of packages) {
    const url = typeof p.repository === "string" ? p.repository : p.repository?.url;
    lines.push("=".repeat(78), `${p.name}@${p.version}`, `License: ${p.license ?? "see below"}`);
    if (url) lines.push(`Source: ${url}`);
    for (const file of p.files) {
      lines.push("", `--- ${file} ---`, "", readFileSync(join(p.root, file), "utf8").trim());
    }
    lines.push("");
  }
  return `${lines.join("\n").replaceAll("\r\n", "\n")}`;
}

export const noticeHeaders = (text) =>
  [...text.matchAll(/^={78}\n(\S+@\S+)$/gm)].map((m) => m[1]).sort();
