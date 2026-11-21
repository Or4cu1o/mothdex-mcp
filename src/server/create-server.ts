import { McpServer } from "@modelcontextprotocol/server";
import { type Clock, MothdexClient } from "../api";
import { TtlCache } from "./cache";
import { Catalog } from "./catalog";
import type { ServerConfig } from "./config";
import type { Env } from "./operations";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";
import { registerTools } from "./tools";

export interface ServerDeps {
  readonly config: ServerConfig;
  readonly version: string;
  readonly client?: MothdexClient;
  readonly clock?: Clock;
  /** Operator warnings; stderr by default (stdout belongs to the protocol). */
  readonly warn?: (message: string) => void;
}

/** The catalog tools, resources and prompts never change while the server runs (tools.md §4). */
const STATIC_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false, subscribe: false },
  prompts: { listChanged: false },
};

const STDERR_WARN = (message: string): void => {
  process.stderr.write(`mothdex-mcp: ${message}\n`);
};

const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

/**
 * One factory call builds one server. The cache and the client (so the token bucket and the 429
 * circuit) are created once, outside, and shared by every instance the factory returns.
 */
export function createServerFactory(deps: ServerDeps): () => McpServer {
  const { config } = deps;
  const client =
    deps.client ??
    new MothdexClient({
      baseUrl: config.baseUrl,
      ...(config.rateLimit === undefined ? {} : { rateLimit: config.rateLimit }),
    });
  const catalog = new Catalog(client, new TtlCache(deps.clock ?? SYSTEM_CLOCK));
  const makeEnv = (signal: AbortSignal): Env => ({
    catalog,
    allowedHosts: config.allowedHosts,
    signal,
    warn: deps.warn ?? STDERR_WARN,
  });
  return () => {
    const server = new McpServer(
      { name: "mothdex", version: deps.version },
      { capabilities: STATIC_CAPABILITIES },
    );
    registerTools(server, makeEnv);
    registerResources(server, makeEnv);
    registerPrompts(server);
    return server;
  };
}
