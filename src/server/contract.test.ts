// T-32: contract tests of docs/contracts/mcp/tools.md, driven through a real MCP client over an
// in-memory pipe (same wire as stdio) with the API answered from the recorded fixtures. They
// pin what a client sees: tools, annotations, structuredContent plus the text copy, the error
// table, resources and prompts. No network, no real clock.
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { type MothdexClient, MothdexError } from "../api";
import { fixture, ok, type Scripted } from "../api/test-helpers";
import { DEFAULT_ALLOWED_HOSTS } from "./config";
import { createServerFactory } from "./create-server";
import { type Harness, startHarness } from "./test-helpers";

const open: Harness[] = [];
let extraClose: (() => Promise<void>) | undefined;
afterEach(async () => {
  for (const h of open.splice(0)) await h.close();
  await extraClose?.();
  extraClose = undefined;
});

async function start(...script: Scripted[]): Promise<Harness> {
  const h = await startHarness(script);
  open.push(h);
  return h;
}

type Result = Awaited<ReturnType<Client["callTool"]>>;
const call = (h: Harness, name: string, args: Record<string, unknown> = {}): Promise<Result> =>
  h.mcp.callTool({ name, arguments: args });

const textCopy = (result: Result): unknown =>
  JSON.parse((result.content[0] as { text: string }).text);

/** Every tool answer is one text content that repeats structuredContent as compact JSON. */
function expectWireShape(result: Result): void {
  expect(result.content).toHaveLength(1);
  expect(result.content[0]).toMatchObject({ type: "text" });
  expect(textCopy(result)).toEqual(result.structuredContent);
  expect((result.content[0] as { text: string }).text).toBe(
    JSON.stringify(result.structuredContent),
  );
}

describe("tools/list", () => {
  it("declares object schemas and the annotations of every read tool", async () => {
    const h = await start({});
    const { tools } = await h.mcp.listTools();
    expect(tools).toHaveLength(7);
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.outputSchema?.type, tool.name).toBe("object");
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: tool.name !== "random_entry",
      });
    }
    expect(tools.map((tool) => tool.name)).not.toContain("download_file");
  });
});

describe("every read tool, happy path (outputs are validated by the client against outputSchema)", () => {
  it("search_entries maps every filter to the request and stays compact", async () => {
    const h = await start(ok("search.json"));
    const result = await call(h, "search_entries", {
      query: "doom",
      platforms: ["dos"],
      regions: ["us"],
      serial: "SLUS-00001",
      page: 2,
      page_size: 25,
    });
    expect(result.isError).toBeFalsy();
    expectWireShape(result);
    expect(JSON.parse(h.seen[0]?.body ?? "{}")).toMatchObject({ page: 2, max_results: 25 });
    const raw = h.seen[0]?.body ?? "";
    for (const value of ["doom", "dos", "us", "SLUS-00001"]) expect(raw).toContain(value);
    expect(JSON.stringify(result.structuredContent).length).toBeLessThan(4096);
  });

  it.each([
    ["query", { query: "doom" }],
    ["platforms", { platforms: ["dos"] }],
    ["regions", { regions: ["jp"] }],
    ["serial", { serial: "X-1" }],
  ])("search_entries accepts the %s filter on its own", async (_label, args) => {
    const h = await start(ok("search.json"));
    expect((await call(h, "search_entries", args)).isError).toBeFalsy();
  });

  it("get_entry returns the entry, a page of links and the total", async () => {
    const h = await start(ok("entry.json"));
    const result = await call(h, "get_entry", { slug: "doom-1993-dos" });
    expectWireShape(result);
    const body = result.structuredContent as {
      entry: { slug: string; size_range?: number[] };
      links: { index: number }[];
      links_total: number;
    };
    expect(body.entry.slug).toBe("doom-1993-dos");
    expect(body.entry.size_range).toEqual([261558, 5313534]); // [smallest, largest] link, in bytes
    expect(body.links.map((link) => link.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(body.links_total).toBe(9);
  });

  it("get_entry honours links_limit and an offset past the end", async () => {
    const h = await start(ok("entry.json"));
    const few = await call(h, "get_entry", { slug: "doom-1993-dos", links_limit: 1 });
    expect((few.structuredContent as { links: unknown[] }).links).toHaveLength(1);
    const past = await call(h, "get_entry", { slug: "doom-1993-dos", links_offset: 50 });
    expect(past.structuredContent).toMatchObject({ links: [], links_total: 9 });
  });

  it("random_entry returns one entry summary and is never answered from memory", async () => {
    const h = await start(ok("random.json"));
    const result = await call(h, "random_entry", {});
    expectWireShape(result);
    expect(result.structuredContent).toMatchObject({
      entry: { slug: "pokemon-battle-card-e-plus-emerald-19-a063-gba-jp", platform: "gba" },
    });
    await call(h, "random_entry", {});
    expect(h.seen).toHaveLength(2);
  });

  it("list_platforms filters by class, brand and fragment, ignoring case", async () => {
    const h = await start(ok("platforms.json"));
    const all = await call(h, "list_platforms", {});
    expectWireShape(all);
    expect((all.structuredContent as { platforms: unknown[] }).platforms).toHaveLength(67);

    const byClass = await call(h, "list_platforms", { class: "HOME CONSOLES" });
    const classes = new Set(
      (byClass.structuredContent as { platforms: { class: string }[] }).platforms.map(
        (platform) => platform.class,
      ),
    );
    expect([...classes]).toEqual(["Home consoles"]);

    const byBrand = await call(h, "list_platforms", { brand: "nintendo", query: "SUPER" });
    const platforms = (
      byBrand.structuredContent as { platforms: { id: string; name: string; brand: string }[] }
    ).platforms;
    expect(platforms.map((platform) => platform.id)).toContain("snes");
    for (const platform of platforms) {
      expect(platform.brand).toBe("Nintendo");
      expect(`${platform.id} ${platform.name}`.toLowerCase()).toContain("super");
    }
    expect(h.seen).toHaveLength(1); // one API call serves all three
  });

  it("list_platforms filters by brand alone", async () => {
    const h = await start(ok("platforms.json"));
    const result = await call(h, "list_platforms", { brand: "SEGA" });
    const platforms = (result.structuredContent as { platforms: { brand: string }[] }).platforms;
    expect(platforms.length).toBeGreaterThan(0);
    expect(platforms.length).toBeLessThan(67);
    expect(platforms.every((platform) => platform.brand === "Sega")).toBe(true);
  });

  it("list_regions and db_info return their fixtures", async () => {
    const h = await start(ok("regions.json"), ok("info.json"));
    const regions = await call(h, "list_regions", {});
    expectWireShape(regions);
    expect((regions.structuredContent as { regions: unknown[] }).regions.length).toBeGreaterThan(0);
    const info = await call(h, "db_info", {});
    expectWireShape(info);
    expect(info.structuredContent).toEqual({ total_entries: 345523 });
  });

  it("resolve_download honours limit, link_index and prefer, and downloads nothing", async () => {
    const h = await start(ok("entry.json"));
    const one = await call(h, "resolve_download", { slug: "doom-1993-dos", limit: 1 });
    expectWireShape(one);
    expect((one.structuredContent as { links: unknown[] }).links).toHaveLength(1);

    const ten = await call(h, "resolve_download", {
      slug: "doom-1993-dos",
      limit: 10,
      prefer: { languages: ["en"], formats: ["exe"] },
    });
    const body = ten.structuredContent as {
      entry: { slug: string; platform: string };
      links: { url: string; trusted_host: boolean }[];
    };
    expect(body.entry).toMatchObject({ slug: "doom-1993-dos", platform: "dos" });
    expect(body.links.length).toBeGreaterThan(3);
    expect(body.links.every((link) => link.url.startsWith("https://proxy.mothdex.net/"))).toBe(
      true,
    );
    expect(body.links.every((link) => link.trusted_host)).toBe(true);

    const picked = await call(h, "resolve_download", { slug: "doom-1993-dos", link_index: 4 });
    const [link] = (picked.structuredContent as { links: { index: number }[] }).links;
    expect(link?.index).toBe(4);
    expect(h.seen).toHaveLength(1); // only the entry lookup, once
    expect(h.seen[0]?.url).toContain("api.mothdex.net");
  });
});

describe("input limits from the shared fragments (invalid_request, API never called)", () => {
  const long = (n: number): string => "a".repeat(n);
  it.each([
    ["query 201 chars", "search_entries", { query: long(201) }],
    ["serial 65 chars", "search_entries", { serial: long(65) }],
    ["21 platform ids", "search_entries", { platforms: Array.from({ length: 21 }, () => "dos") }],
    ["uppercase platform id", "search_entries", { platforms: ["DOS"] }],
    ["region id of 33 chars", "search_entries", { regions: [long(33)] }],
    ["page_size 0", "search_entries", { query: "x", page_size: 0 }],
    ["fractional page", "search_entries", { query: "x", page: 1.5 }],
    ["slug of 257 chars", "get_entry", { slug: long(257) }],
    ["links_limit 0", "get_entry", { slug: "x", links_limit: 0 }],
    ["links_limit 26", "get_entry", { slug: "x", links_limit: 26 }],
    ["page_size 26", "search_entries", { query: "x", page_size: 26 }],
    ["page 0", "search_entries", { query: "x", page: 0 }],
    ["links_offset -1", "get_entry", { slug: "x", links_offset: -1 }],
    ["limit 11", "resolve_download", { slug: "x", limit: 11 }],
    ["limit 0", "resolve_download", { slug: "x", limit: 0 }],
    [
      "six preferred languages",
      "resolve_download",
      { slug: "x", prefer: { languages: ["a", "b", "c", "d", "e", "f"] } },
    ],
    ["platform query 51 chars", "list_platforms", { query: long(51) }],
    ["a number as slug", "get_entry", { slug: 5 }],
  ])("%s", async (_label, tool, args) => {
    const h = await start(ok("search.json"));
    const result = await call(h, tool, args);
    expect(result.isError).toBe(true);
    expectWireShape(result);
    expect(result.structuredContent).toMatchObject({
      error: { code: "invalid_request", retryable: false },
    });
    expect(h.seen).toHaveLength(0);
  });

  it("accepts the limits themselves", async () => {
    const h = await start(ok("search.json"));
    const result = await call(h, "search_entries", {
      query: "a".repeat(200),
      page_size: 25,
      platforms: Array.from({ length: 20 }, () => "dos"),
    });
    expect(result.isError).toBeFalsy();
  });

  it("an error never echoes the rejected value", async () => {
    const h = await start({});
    const result = await call(h, "get_entry", {
      slug: "SECRET-VALUE-".repeat(20),
      links_limit: 99,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET-VALUE");
  });
});

describe("the error table, as a client sees it", () => {
  const errorOf = (result: Result) => {
    expect(result.isError).toBe(true);
    expectWireShape(result);
    return (result.structuredContent as { error: Record<string, unknown> }).error;
  };
  const info = (error: string, code?: string): Scripted => ({
    body: JSON.stringify({ info: { error, ...(code === undefined ? {} : { code }) }, data: {} }),
  });
  const failWith = async (step: Scripted) => errorOf(await call(await start(step), "db_info"));

  it("not_found: an HTTP 200 with info.error", async () => {
    const h = await start(ok("entry-not-found.json"));
    expect(errorOf(await call(h, "get_entry", { slug: "x" }))).toMatchObject({
      code: "not_found",
      retryable: false,
    });
  });

  it("invalid_request from the API itself", async () => {
    expect(await failWith(info("Invalid input provided"))).toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
  });

  it("rate_limited carries retry_after_s only when the cooldown is known", async () => {
    expect(await failWith({ status: 429, headers: { "retry-after": "3" } })).toMatchObject({
      code: "rate_limited",
      retryable: true,
      retry_after_s: 3,
    });
    const unknown = await failWith({ status: 429 });
    expect(unknown).toMatchObject({ code: "rate_limited", retryable: true });
    expect(unknown).not.toHaveProperty("retry_after_s");
  });

  it("network: a transport failure is retryable and leaks no cause", async () => {
    const h = await start({ fail: new Error("connect ECONNREFUSED 10.1.2.3:443 secret-host") });
    const result = await call(h, "db_info");
    expect(errorOf(result)).toMatchObject({ code: "network", retryable: true });
    expect(JSON.stringify(result)).not.toContain("secret-host");
    expect(JSON.stringify(result)).not.toContain("10.1.2.3");
  });

  it("upstream is retryable for a 5xx and for a database error answered with HTTP 200", async () => {
    expect(await failWith({ status: 503 })).toMatchObject({ code: "upstream", retryable: true });
    expect(await failWith(info("Database operation failed"))).toMatchObject({
      code: "upstream",
      retryable: true,
    });
  });

  it("an unknown info.error is upstream and NOT retryable", async () => {
    expect(await failWith(info("something nobody documented"))).toMatchObject({
      code: "upstream",
      retryable: false,
    });
  });

  it("api_incompatible: an answer that is not API v1 (data without its key, and an HTTP 404)", async () => {
    const bad = await start({ body: '{"info":{},"data":{}}' });
    expect(errorOf(await call(bad, "search_entries", { query: "x" }))).toMatchObject({
      code: "api_incompatible",
      retryable: false,
    });
    expect(await failWith({ status: 404 })).toMatchObject({
      code: "api_incompatible",
      retryable: false,
    });
  });

  it("untrusted_redirect is never retryable", async () => {
    expect(
      await failWith({ status: 307, headers: { location: "http://evil.example/x" } }),
    ).toMatchObject({ code: "untrusted_redirect", retryable: false });
  });

  it("a failure is not cached: the next call asks the API again", async () => {
    const h = await start({ status: 400 }, ok("info.json"));
    expect((await call(h, "db_info")).isError).toBe(true);
    expect((await call(h, "db_info")).isError).toBeFalsy();
  });
});

/** A server whose API client is a stub, for the two codes a fixture cannot produce. */
async function startWithStub(stub: Partial<Record<keyof MothdexClient, unknown>>): Promise<Client> {
  const server = createServerFactory({
    config: {
      baseUrl: "https://api.mothdex.net/v1",
      rateLimit: undefined,
      allowedHosts: new Set(DEFAULT_ALLOWED_HOSTS),
    },
    version: "0.0.0-test",
    client: stub as unknown as MothdexClient,
  })();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0" });
  await server.connect(serverSide);
  await mcp.connect(clientSide);
  extraClose = async () => {
    await mcp.close();
    await server.close();
  };
  return mcp;
}

describe("canceled and internal", () => {
  it("canceled: the client's cancel kind is reported as canceled, not retryable", async () => {
    const mcp = await startWithStub({
      info: async () => {
        throw new MothdexError({ kind: "canceled", op: "info" });
      },
    });
    const result = await mcp.callTool({ name: "db_info", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: "canceled", retryable: false },
    });
  });

  it("cancelling the request reaches the API call as an aborted signal", async () => {
    let seenSignal: AbortSignal | undefined;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted!: () => void;
    const sawAbort = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const mcp = await startWithStub({
      info: (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          seenSignal = signal;
          signal.addEventListener("abort", () => {
            aborted();
            reject(new MothdexError({ kind: "canceled", op: "info" }));
          });
          started();
        }),
    });
    const controller = new AbortController();
    const pending = mcp
      .callTool({ name: "db_info", arguments: {} }, { signal: controller.signal })
      .catch((error: unknown) => error);
    await running;
    controller.abort();
    await sawAbort;
    expect(seenSignal?.aborted).toBe(true);
    await pending;
  });

  it("internal: anything unexpected is generic, not retryable, and leaks nothing", async () => {
    const mcp = await startWithStub({
      info: async () => {
        throw new TypeError("cannot read /home/secret-user/.token of undefined");
      },
    });
    const result = await mcp.callTool({ name: "db_info", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: "internal", retryable: false },
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("secret-user");
    expect(text).not.toContain("TypeError");
  });

  it("a non-Error throw is internal too", async () => {
    const mcp = await startWithStub({
      info: async () => {
        throw "a plain string with a secret";
      },
    });
    const result = await mcp.callTool({ name: "db_info", arguments: {} });
    expect(result.structuredContent).toMatchObject({ error: { code: "internal" } });
    expect(JSON.stringify(result)).not.toContain("plain string");
  });
});

describe("server identity, resources and prompts", () => {
  it("is named mothdex, with static capabilities and no subscriptions", async () => {
    const h = await start({});
    expect(h.mcp.getServerVersion()).toMatchObject({ name: "mothdex", version: "0.0.0-test" });
    const caps = h.mcp.getServerCapabilities();
    expect(caps?.tools?.listChanged).toBe(false);
    expect(caps?.resources).toMatchObject({ listChanged: false, subscribe: false });
    expect(caps?.prompts?.listChanged).toBe(false);
  });

  it("lists two fixed resources and the entry template, all JSON", async () => {
    const h = await start({});
    const { resources } = await h.mcp.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      "mothdex://platforms",
      "mothdex://regions",
    ]);
    for (const resource of resources) expect(resource.mimeType).toBe("application/json");
    const { resourceTemplates } = await h.mcp.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      "mothdex://entry/{slug}",
    ]);
    expect(resourceTemplates[0]?.mimeType).toBe("application/json");
  });

  it("mothdex://platforms and mothdex://regions equal their tools", async () => {
    const h = await start(ok("platforms.json"), ok("regions.json"));
    const platforms = await h.mcp.readResource({ uri: "mothdex://platforms" });
    const regions = await h.mcp.readResource({ uri: "mothdex://regions" });
    const toolPlatforms = await call(h, "list_platforms", {});
    const toolRegions = await call(h, "list_regions", {});
    expect(JSON.parse((platforms.contents[0] as { text: string }).text)).toEqual(
      toolPlatforms.structuredContent,
    );
    expect(JSON.parse((regions.contents[0] as { text: string }).text)).toEqual(
      toolRegions.structuredContent,
    );
    expect(h.seen).toHaveLength(2); // the tools were answered from memory
  });

  it("mothdex://entry/{slug} is get_entry with 25 links", async () => {
    const h = await start(ok("entry.json"));
    const resource = await h.mcp.readResource({ uri: "mothdex://entry/doom-1993-dos" });
    const tool = await call(h, "get_entry", { slug: "doom-1993-dos", links_limit: 25 });
    expect(JSON.parse((resource.contents[0] as { text: string }).text)).toEqual(
      tool.structuredContent,
    );
  });

  it("mothdex://entry/{slug} caps the links at 25 where get_entry defaults to 10", async () => {
    const entry = JSON.parse(fixture("entry.json")) as {
      data: { entry: { links: unknown[] } };
    };
    const links = entry.data.entry.links;
    while (links.length < 30) links.push(structuredClone(links[0]));
    const h = await start({ body: JSON.stringify(entry) });
    const resource = await h.mcp.readResource({ uri: "mothdex://entry/doom-1993-dos" });
    const fromResource = JSON.parse((resource.contents[0] as { text: string }).text) as {
      links: unknown[];
      links_total: number;
    };
    expect(fromResource.links).toHaveLength(25);
    expect(fromResource.links_total).toBe(30);
    const tool = await call(h, "get_entry", { slug: "doom-1993-dos" });
    expect((tool.structuredContent as { links: unknown[] }).links).toHaveLength(10);
  });

  it("lists exactly the two prompts with their arguments", async () => {
    const h = await start({});
    const { prompts } = await h.mcp.listPrompts();
    const byName = Object.fromEntries(prompts.map((prompt) => [prompt.name, prompt.arguments]));
    expect(Object.keys(byName).sort()).toEqual(["build_collection", "find_best_version"]);
    const required = (name: string) =>
      (byName[name] ?? []).filter((arg) => arg.required).map((arg) => arg.name);
    const all = (name: string) => (byName[name] ?? []).map((arg) => arg.name).sort();
    expect(all("find_best_version")).toEqual(["languages", "platform", "region", "title"]);
    expect(required("find_best_version")).toEqual(["title"]);
    expect(all("build_collection")).toEqual(["criteria", "max_items", "platform"]);
    expect(required("build_collection")).toEqual(["platform"]);
  });

  it("build_collection defaults to 20 items and clamps to 1..50", async () => {
    const h = await start({});
    const textFor = async (max?: string): Promise<string> => {
      const result = await h.mcp.getPrompt({
        name: "build_collection",
        arguments: { platform: "dos", ...(max === undefined ? {} : { max_items: max }) },
      });
      return ((result.messages[0]?.content ?? {}) as { text: string }).text;
    };
    expect(await textFor()).toContain("at most 20");
    expect(await textFor("0")).toContain("at most 1 ");
    expect(await textFor("50")).toContain("at most 50");
    expect(await textFor("999")).toContain("at most 50");
  });

  it("a prompt without its required argument is refused", async () => {
    const h = await start({});
    await expect(h.mcp.getPrompt({ name: "find_best_version", arguments: {} })).rejects.toThrow();
    await expect(
      h.mcp.getPrompt({ name: "build_collection", arguments: { platform: "dos", max_items: "x" } }),
    ).rejects.toThrow();
  });
});

describe("fixtures", () => {
  it("every fixture the contract tests lean on exists and parses", () => {
    for (const name of ["search", "entry", "random", "platforms", "regions", "info"]) {
      expect(() => JSON.parse(fixture(`${name}.json`))).not.toThrow();
    }
  });
});
