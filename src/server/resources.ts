import {
  type McpServer,
  type ReadResourceResult,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { isMothdexError } from "../api";
import { toToolError } from "./errors";
import { type Env, getEntry, listPlatforms, listRegions } from "./operations";

const JSON_MIME = "application/json";
const MAX_LINKS = 25;

function asJson(uri: URL, value: unknown): ReadResourceResult {
  return { contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(value) }] };
}

/** A missing entry is the protocol's "resource not found"; every other failure keeps its tool message. */
async function read(uri: URL, load: () => Promise<unknown>): Promise<ReadResourceResult> {
  try {
    return asJson(uri, await load());
  } catch (error) {
    if (isMothdexError(error) && error.kind === "not_found") {
      throw new ResourceNotFoundError(uri.href);
    }
    throw new Error(toToolError(error).message);
  }
}

/** Slug from the URI template variable: one segment, percent-decoded. */
function slugOf(variable: string | string[] | undefined): string {
  const raw = Array.isArray(variable) ? (variable[0] ?? "") : (variable ?? "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** mothdex://platforms, mothdex://regions and the template mothdex://entry/{slug}; no subscriptions. */
export function registerResources(server: McpServer, makeEnv: (signal: AbortSignal) => Env): void {
  server.registerResource(
    "platforms",
    "mothdex://platforms",
    { title: "Platforms", description: "All platforms and their ids", mimeType: JSON_MIME },
    (uri, ctx) => read(uri, () => listPlatforms(makeEnv(ctx.mcpReq.signal), {})),
  );
  server.registerResource(
    "regions",
    "mothdex://regions",
    { title: "Regions", description: "All regions and their ids", mimeType: JSON_MIME },
    (uri, ctx) => read(uri, () => listRegions(makeEnv(ctx.mcpReq.signal))),
  );
  server.registerResource(
    "entry",
    new ResourceTemplate("mothdex://entry/{slug}", { list: undefined }),
    {
      title: "Entry",
      description: "One entry with up to 25 of its links (same as get_entry)",
      mimeType: JSON_MIME,
    },
    (uri, variables, ctx) =>
      read(uri, () =>
        getEntry(makeEnv(ctx.mcpReq.signal), {
          slug: slugOf(variables.slug),
          offset: 0,
          limit: MAX_LINKS,
        }),
      ),
  );
}
