import { serveStdio } from "@modelcontextprotocol/server/stdio";
import pkg from "../package.json" with { type: "json" };
import { ConfigError, loadConfig } from "./server/config";
import { createServerFactory } from "./server/create-server";

/** Stdout belongs to the protocol: anything for a human goes to stderr. */
function main(): void {
  if (process.argv.includes("--version")) {
    process.stdout.write(`mothdex-mcp ${pkg.version}\n`);
    return;
  }
  try {
    const config = loadConfig(process.env);
    serveStdio(createServerFactory({ config, version: pkg.version }), {
      onerror: (error) => process.stderr.write(`mothdex-mcp: ${error.message}\n`),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to start";
    process.stderr.write(`mothdex-mcp: ${message}\n`);
    process.exitCode = error instanceof ConfigError ? 2 : 1;
  }
}

main();
