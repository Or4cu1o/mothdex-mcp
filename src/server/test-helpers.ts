import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { type FakeClock, makeClient, type Scripted } from "../api/test-helpers";
import { DEFAULT_ALLOWED_HOSTS } from "./config";
import { createServerFactory } from "./create-server";
import type { DownloadRuntime } from "./download/run";

export interface Harness {
  readonly mcp: Client;
  readonly clock: FakeClock;
  /** Requests the API fake received. */
  readonly seen: { method: string; url: string; body: string | undefined }[];
  close(): Promise<void>;
}

/** A real MCP client talking to the server over an in-memory pipe; the API answers from `script`. */
export async function startHarness(
  script: readonly Scripted[],
  warn: (message: string) => void = () => {},
  download?: DownloadRuntime,
): Promise<Harness> {
  const { client, clock, seen } = makeClient(script);
  const server = createServerFactory({
    config: {
      baseUrl: "https://api.mothdex.net/v1",
      rateLimit: undefined,
      allowedHosts: new Set(DEFAULT_ALLOWED_HOSTS),
    },
    version: "0.0.0-test",
    client,
    clock,
    warn,
    ...(download === undefined ? {} : { download }),
  })();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0" });
  await server.connect(serverSide);
  await mcp.connect(clientSide);
  await mcp.listTools(); // lets the client validate structuredContent against each outputSchema
  return {
    mcp,
    clock,
    seen,
    close: async () => {
      await mcp.close();
      await server.close();
    },
  };
}
