import { serveStdio } from "@modelcontextprotocol/server/stdio";
import pkg from "../package.json" with { type: "json" };
import { ConfigError, loadConfig } from "./server/config";
import { createServerFactory } from "./server/create-server";
import { prepareDownload } from "./server/download/setup";
import { installShutdownHandlers } from "./server/download/shutdown";

/** Stdout belongs to the protocol: anything for a human goes to stderr. */
async function main(): Promise<void> {
  if (process.argv.includes("--version")) {
    process.stdout.write(`mothdex-mcp ${pkg.version}\n`);
    return;
  }
  try {
    const config = loadConfig(process.env);
    const warn = (message: string): void => {
      process.stderr.write(`mothdex-mcp: ${message}\n`);
    };
    const download = await prepareDownload(process.env, warn);
    if (download !== undefined) installShutdownHandlers(download.state);
    serveStdio(
      createServerFactory({ config, version: pkg.version, ...(download ? { download } : {}) }),
      {
        onerror: (error) => process.stderr.write(`mothdex-mcp: ${error.message}\n`),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to start";
    process.stderr.write(`mothdex-mcp: ${message}\n`);
    process.exitCode = error instanceof ConfigError ? 2 : 1;
  }
}

void main();
