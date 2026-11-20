import { describe, expect, it } from "vitest";
import { isMothdexError } from "./errors";
import { fixture, makeClient, ok } from "./test-helpers";

describe("MothdexClient against the shared fixtures", () => {
  it("decodes search and omits unset filters from the body", async () => {
    const { client, seen } = makeClient([ok("search.json")]);
    const res = await client.search({ searchKey: "doom", platforms: ["dos"], maxResults: 3 });
    expect(JSON.parse(seen[0]?.body ?? "")).toEqual({
      search_key: "doom",
      platforms: ["dos"],
      max_results: 3,
    });
    expect(seen[0]?.url).toBe("https://api.mothdex.net/v1/search");
    const first = res.results[0];
    expect(first?.slug).toBe("doom-1993-dos");
    expect(first?.serial).toBe("");
    expect(first?.links[0]?.sizeStr).toBe("2.06M");
    expect(res.totalPages).toBeGreaterThanOrEqual(1);
  });

  it("returns the empty search raw (page 0 of 0)", async () => {
    const { client } = makeClient([ok("search-empty.json")]);
    const res = await client.search({ searchKey: "zzzqqq" });
    expect(res).toMatchObject({ results: [], totalResults: 0, currentPage: 0, totalPages: 0 });
  });

  it.each([
    [
      "entry",
      (c: ReturnType<typeof makeClient>["client"]) => c.entry("doom-1993-dos"),
      "entry.json",
    ],
    [
      "random",
      (c: ReturnType<typeof makeClient>["client"]) => c.random({ platforms: ["gba"] }),
      "random.json",
    ],
  ])("decodes %s", async (_name, call, file) => {
    const { client } = makeClient([ok(file)]);
    const entry = await call(client);
    expect(entry.slug).not.toBe("");
    expect(entry.regions).toBeInstanceOf(Array);
    expect(entry.links.length).toBeGreaterThan(0);
  });

  it("sorts platforms and regions by id and fills id from the map key", async () => {
    const platforms = await makeClient([ok("platforms.json")]).client.platforms();
    const ids = platforms.map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
    expect(platforms.find((p) => p.id === "nes")?.name).toBe("Nintendo Entertainment System");
    const regions = await makeClient([ok("regions.json")]).client.regions();
    expect(regions.map((r) => r.id)).toEqual(regions.map((r) => r.id).sort());
  });

  it("decodes info", async () => {
    const info = await makeClient([ok("info.json")]).client.info();
    expect(info.totalEntries).toBeGreaterThan(0);
  });

  it("maps HTTP 200 + info.error to not_found without retrying (A6)", async () => {
    const { client, seen } = makeClient([ok("entry-not-found.json")]);
    const error = await client.entry("nope").catch((e: unknown) => e);
    expect(isMothdexError(error) && error.kind).toBe("not_found");
    expect(seen).toHaveLength(1);
  });

  it("maps the HTTP 200 empty-slug answer to invalid_request", async () => {
    const { client } = makeClient([ok("entry-empty-slug.json")]);
    // Local validation catches "" first, so send a slug the API itself rejects with the recorded answer.
    const error = await client.entry("x").catch((e: unknown) => e);
    expect(isMothdexError(error) && error.kind).toBe("invalid_request");
  });

  it("maps the recorded HTTP 400 body to invalid_request with the server message", async () => {
    const { client } = makeClient([{ status: 400, body: fixture("search-bad-json.json") }]);
    const error = await client.search({ searchKey: "x" }).catch((e: unknown) => e);
    expect(isMothdexError(error) && [error.kind, error.detail]).toEqual([
      "invalid_request",
      "Malformed JSON in request body",
    ]);
  });

  it("fails with decode when data lacks the expected key", async () => {
    const { client } = makeClient([{ body: '{"info":{},"data":{}}' }]);
    const error = await client.info().catch((e: unknown) => e);
    expect(isMothdexError(error) && error.kind).toBe("decode");
  });
});
