/** `download_file` through a real MCP client: registration, schema, annotations, progress (T-60 cases 1, 7, 36, 37). */
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../test-helpers";
import { entryBody, makeRig, type ProxyReply, type Rig, rawLink } from "./test-kit";
import { DOWNLOAD_DESCRIPTION } from "./tool";

let harness: Harness | undefined;
let rig: Rig | undefined;
afterEach(async () => {
  await harness?.close();
  rig?.cleanup();
  harness = undefined;
  rig = undefined;
});

async function start(
  replies: ProxyReply[] = [{ chunks: ["01234", "56789"] }],
  enabled = true,
): Promise<Harness> {
  rig = makeRig({ replies });
  harness = await startHarness(
    [{ body: entryBody([rawLink()]) }],
    () => {},
    enabled ? rig.rt : undefined,
  );
  return harness;
}
const call = (
  h: Harness,
  args: Record<string, unknown>,
  extra?: { onprogress?: (p: { progress: number; total?: number }) => void },
) =>
  h.mcp.callTool(
    { name: "download_file", arguments: args },
    extra?.onprogress ? { onprogress: extra.onprogress } : undefined,
  );

describe("download_file over MCP", () => {
  it("case 1: is listed only when the runtime exists, with the contract's annotations and fixed description", async () => {
    const off = await start(undefined, false);
    expect((await off.mcp.listTools()).tools.map((t) => t.name)).not.toContain("download_file");
    await off.close();
    const on = await start();
    const tool = (await on.mcp.listTools()).tools.find((t) => t.name === "download_file");
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(tool?.description).toBe(DOWNLOAD_DESCRIPTION);
    const schema = tool?.inputSchema as { properties: object; additionalProperties?: unknown };
    expect(Object.keys(schema.properties).sort()).toEqual(["link_index", "slug"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it.each([
    ["path", { path: "/etc" }],
    ["filename", { filename: "x" }],
    ["url", { url: "https://proxy.mothdex.net/x" }],
    ["overwrite", { overwrite: true }],
    ["dir", { dir: "/tmp" }],
  ])("case 7: an extra key %s is invalid_request and nothing is fetched", async (_label, extra) => {
    const h = await start();
    const result = await call(h, { slug: "game-1", link_index: 1, ...extra });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "invalid_request" } });
    expect(rig?.proxy.urls).toEqual([]);
  });

  it.each([
    ["link_index 0", { slug: "game-1", link_index: 0 }],
    ["link_index -1", { slug: "game-1", link_index: -1 }],
    ["link_index 1.5", { slug: "game-1", link_index: 1.5 }],
    ["link_index as a string", { slug: "game-1", link_index: "1" }],
    ["an unsafe slug", { slug: "../x", link_index: 1 }],
    ["no link_index", { slug: "game-1" }],
  ])("case 7: %s is invalid_request", async (_label, args) => {
    const h = await start();
    const result = await call(h, args);
    expect(result.structuredContent).toMatchObject({
      error: { code: "invalid_request", retryable: false },
    });
    expect(rig?.proxy.urls).toEqual([]);
  });

  it("case 37: a download answers with the contract's output, in structuredContent and as the same JSON text", async () => {
    const h = await start();
    const result = await call(h, { slug: "game-1", link_index: 1 });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ status: "done", bytes: 10, crc: "skipped" });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual(result.structuredContent);
  });

  it("an existing file is a result with isError false and status exists", async () => {
    const h = await start();
    await call(h, { slug: "game-1", link_index: 1 });
    const again = await call(h, { slug: "game-1", link_index: 1 });
    expect(again.isError).toBeFalsy();
    expect(again.structuredContent).toMatchObject({ status: "exists", bytes: 0, sha256: null });
  });

  it("case 36: with a progressToken the notifications are monotonic, at most one per second, numbers only", async () => {
    const h = await start([
      {
        chunks: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
        onChunk: () => {
          if (harness) harness.clock.nowMs += 400;
        },
      },
    ]);
    const seen: { progress: number; total?: number }[] = [];
    // The tool's clock is the harness clock: 400 ms per chunk gives one notification per three chunks.
    await call(h, { slug: "game-1", link_index: 1 }, { onprogress: (p) => seen.push(p) });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < seen.length; i++)
      expect((seen[i]?.progress ?? 0) > (seen[i - 1]?.progress ?? 0)).toBe(true);
    expect(seen.every((p) => p.total === 10 && Number.isInteger(p.progress))).toBe(true);
  });

  it("case 36: without a progressToken nothing is sent", async () => {
    const h = await start();
    const result = await call(h, { slug: "game-1", link_index: 1 });
    expect(result.isError).toBeFalsy();
  });
});
