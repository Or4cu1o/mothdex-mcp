// Stdio smoke test of the BUILT server (T-32): spawn dist/mothdex-mcp.mjs, initialize, list the
// tools, make one successful and one failing call against a local fake API, and require that
// stdout carries nothing but JSON-RPC messages. No network beyond 127.0.0.1, no live API.
// Run `pnpm build` first.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/mothdex-mcp.mjs", import.meta.url));
const INFO = readFileSync(new URL("../src/api/testdata/api-v1/info.json", import.meta.url), "utf8");
const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const TOOLS = [
  "db_info",
  "get_entry",
  "list_platforms",
  "list_regions",
  "random_entry",
  "resolve_download",
  "search_entries",
];
const WATCHDOG_MS = 30_000;

const failures = [];
const check = (name, condition, detail = "") => {
  if (!condition) failures.push(`${name}${detail === "" ? "" : `: ${detail}`}`);
};

/** The fake API: GET /info answers the recorded fixture; every request is counted. */
async function startFakeApi() {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    res.end(req.url === "/info" ? INFO : '{"info":{"error":"Entry not found"},"data":{}}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    hits,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function checkVersionFlag() {
  const run = spawnSync(process.execPath, [SERVER, "--version"], { encoding: "utf8" });
  check("--version exits 0", run.status === 0, String(run.status));
  check("--version prints one line", run.stdout === `mothdex-mcp ${VERSION}\n`, run.stdout);
}

function checkBadConfig() {
  const run = spawnSync(process.execPath, [SERVER], {
    encoding: "utf8",
    env: { ...process.env, MOTHDEX_API_RATE_LIMIT: "fast" },
  });
  check("a bad MOTHDEX_API_RATE_LIMIT exits 2", run.status === 2, String(run.status));
  check("a bad config writes nothing to stdout", run.stdout === "", run.stdout);
  check("a bad config says so on stderr", run.stderr.includes("MOTHDEX_API_RATE_LIMIT"));
}

async function checkProtocol() {
  const api = await startFakeApi();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MOTHDEX_API_BASE_URL: api.url },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdoutLines = [];
  const waiting = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    stdoutLines.push(line);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    waiting.get(message.id)?.(message);
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) =>
    child.on("exit", (code, signal) => resolve({ code, signal })),
  );
  const watchdog = setTimeout(() => child.kill("SIGKILL"), WATCHDOG_MS);

  let nextId = 1;
  const send = (message) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, resolve);
      exited.then(() => reject(new Error(`server exited before answering ${method}`)));
      send({ id, method, params });
    });

  try {
    const init = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0" },
    });
    check("initialize answers", init.result !== undefined, JSON.stringify(init.error));
    check("server name", init.result?.serverInfo?.name === "mothdex");
    check(
      "server version",
      init.result?.serverInfo?.version === VERSION,
      init.result?.serverInfo?.version,
    );
    send({ method: "notifications/initialized" });

    const list = await request("tools/list", {});
    const names = (list.result?.tools ?? []).map((tool) => tool.name).sort();
    check("seven read tools", JSON.stringify(names) === JSON.stringify(TOOLS), names.join(","));

    const info = await request("tools/call", { name: "db_info", arguments: {} });
    check("db_info succeeds", info.result?.isError !== true, JSON.stringify(info.result));
    check("db_info structuredContent", info.result?.structuredContent?.total_entries === 345523);
    check(
      "db_info text copy",
      info.result?.content?.[0]?.text === JSON.stringify(info.result?.structuredContent),
    );
    check("the fake API got GET /info", api.hits.includes("GET /info"), api.hits.join(","));

    const hitsBefore = api.hits.length;
    const bad = await request("tools/call", { name: "search_entries", arguments: {} });
    check("a call with no filter is an error result", bad.result?.isError === true);
    check(
      "that error is invalid_request",
      bad.result?.structuredContent?.error?.code === "invalid_request",
    );
    check("and never reaches the API", api.hits.length === hitsBefore);
  } catch (error) {
    failures.push(`protocol run: ${error.message}`);
  } finally {
    child.stdin.end();
  }

  const { code, signal } = await exited;
  clearTimeout(watchdog);
  await api.close();
  check("exits 0 when stdin closes", code === 0, `code ${code} signal ${signal}`);
  const stray = stdoutLines.filter((line) => {
    try {
      return JSON.parse(line).jsonrpc !== "2.0";
    } catch {
      return true;
    }
  });
  check("stdout holds only JSON-RPC", stray.length === 0, stray.slice(0, 3).join(" | "));
  check("stdout is not empty", stdoutLines.length >= 4, String(stdoutLines.length));
  if (stderr !== "") process.stderr.write(`server stderr:\n${stderr}\n`);
}

checkVersionFlag();
checkBadConfig();
await checkProtocol();

if (failures.length > 0) {
  console.error(`smoke test FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("smoke test ok: initialize, tools/list (7), db_info, invalid_request, clean stdout");
