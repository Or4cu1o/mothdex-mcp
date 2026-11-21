// Fails when a fixture copy differs from mothdex-cli main (the owner of the fixtures): the API v1 fixtures in
// src/api/testdata/api-v1/ and the Sanitize vectors in src/server/testdata/.
// Usage: node scripts/check-fixtures.mjs [--update]   (--update overwrites the local copy)
// Only GET requests to api.github.com and raw.githubusercontent.com; GITHUB_TOKEN, when set, is sent
// to api.github.com only.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const OWNER_REPO = "Or4cu1o/mothdex-cli";
/** Each set pairs a directory of mothdex-cli with its copy here; `only` limits it to named files. */
const SETS = [
  {
    remote: "pkg/mothdex/testdata/api-v1",
    local: new URL("../src/api/testdata/api-v1/", import.meta.url),
    only: undefined,
  },
  {
    remote: "internal/proxy/testdata",
    local: new URL("../src/server/testdata/", import.meta.url),
    only: ["sanitize-vectors.json"],
  },
];
const FETCH_TIMEOUT_MS = 20_000;
const SAFE_NAME = /^[a-z0-9-]+\.json$/;

async function getJson(url, token) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "mothdex-mcp-fixture-check",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  // redirect: "error" so the Authorization header can never follow a redirect.
  const res = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET ${url} answered HTTP ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "mothdex-mcp-fixture-check" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET ${url} answered HTTP ${res.status}`);
  return res.text();
}

async function readLocal(set) {
  const all = (await readdir(set.local)).filter((name) => !set.only || set.only.includes(name));
  const unsafe = all.filter((name) => !SAFE_NAME.test(name));
  if (unsafe.length > 0) throw new Error(`unexpected local file names: ${unsafe.join(", ")}`);
  const names = all;
  return new Map(
    await Promise.all(
      names.map(async (name) => [name, await readFile(new URL(name, set.local), "utf8")]),
    ),
  );
}

async function readRemote(token) {
  // Pin one commit first so the listings and the contents cannot come from different commits.
  const sha = (await getJson(`https://api.github.com/repos/${OWNER_REPO}/commits/main`, token)).sha;
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("unexpected commit sha from the GitHub API");
  const sets = await Promise.all(
    SETS.map(async (set) => {
      const listing = await getJson(
        `https://api.github.com/repos/${OWNER_REPO}/contents/${set.remote}?ref=${sha}`,
        token,
      );
      const names = listing
        .filter((item) => item.type === "file")
        .map((item) => item.name)
        .filter((name) => !set.only || set.only.includes(name));
      const unsafe = names.filter((name) => !SAFE_NAME.test(name));
      if (unsafe.length > 0) throw new Error(`unexpected remote file names: ${unsafe.join(", ")}`);
      return new Map(
        await Promise.all(
          names.map(async (name) => [
            name,
            await getText(
              `https://raw.githubusercontent.com/${OWNER_REPO}/${sha}/${set.remote}/${name}`,
            ),
          ]),
        ),
      );
    }),
  );
  return { sha, sets };
}

function diff(local, remote) {
  const names = [...new Set([...local.keys(), ...remote.keys()])].sort();
  return names.flatMap((name) => {
    if (!remote.has(name)) return [`only in mothdex-mcp: ${name}`];
    if (!local.has(name)) return [`only in mothdex-cli: ${name}`];
    return local.get(name) === remote.get(name) ? [] : [`content differs: ${name}`];
  });
}

const update = process.argv.includes("--update");
const { sha, sets: remoteSets } = await readRemote(process.env.GITHUB_TOKEN);
const problems = [];
for (const [index, set] of SETS.entries()) {
  const remote = remoteSets[index];
  problems.push(
    ...diff(await readLocal(set), remote).map((problem) => `${set.remote}: ${problem}`),
  );
}
const total = remoteSets.reduce((sum, remote) => sum + remote.size, 0);

if (problems.length === 0) {
  console.log(`fixtures match mothdex-cli main (${sha.slice(0, 12)}): ${total} files`);
} else if (update) {
  for (const [index, set] of SETS.entries()) {
    await mkdir(set.local, { recursive: true });
    await Promise.all(
      [...remoteSets[index]].map(([name, text]) => writeFile(new URL(name, set.local), text)),
    );
  }
  console.log(`copy updated to mothdex-cli main (${sha.slice(0, 12)}); review: git status`);
} else {
  console.error(`fixtures diverge from mothdex-cli main (${sha.slice(0, 12)}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("Run: node scripts/check-fixtures.mjs --update");
  process.exit(1);
}
