import { describe, expect, it } from "vitest";
import type { Link } from "../api";
import { MothdexError } from "../api";
import { FakeClock } from "../api/test-helpers";
import { TtlCache } from "./cache";
import { searchKey } from "./catalog";
import { loadConfig } from "./config";
import { InvalidRequest, toToolError } from "./errors";
import { isTrustedHost, rankLinks } from "./links";
import { parseMaxItems } from "./prompts";

const link = (over: Partial<Link> & { url?: string }): Link => ({
  type: "Game",
  extras: [],
  format: "zip",
  filename: "f.zip",
  url: "https://proxy.mothdex.net/file/a",
  size: 1,
  sizeStr: "1B",
  sourceName: "s",
  sourceUrl: "https://s.example/",
  ...over,
});

const HOSTS = new Set(["proxy.mothdex.net"]);
const order = (links: Link[], languages: string[] = [], formats: string[] = []) =>
  rankLinks(links, { languages, formats }, HOSTS).map((item) => item.index);

describe("rankLinks", () => {
  it("keeps Game links when there are any, otherwise all", () => {
    expect(order([link({ type: "Demo" }), link({}), link({ type: "Patch" })])).toEqual([2]);
    expect(order([link({ type: "Demo" }), link({ type: "Patch" })])).toEqual([1, 2]);
  });

  it("sorts by preferred language order (tokens split on commas and spaces), then format, then API order", () => {
    const links = [
      link({ extras: ["En"], format: "iso" }),
      link({ extras: ["Fr, En"], format: "zip" }),
      link({ extras: ["Pt"], format: "zip" }),
      link({ extras: [], format: "zip" }),
    ];
    expect(order(links, ["fr", "en"])).toEqual([2, 1, 3, 4]);
    expect(order(links, [], ["zip", "iso"])).toEqual([2, 3, 4, 1]);
    expect(order(links)).toEqual([1, 2, 3, 4]);
  });

  it("puts untrusted hosts after trusted ones and says why", () => {
    const links = [
      link({ url: "https://evil.example/x" }),
      link({}),
      link({ url: "http://proxy.mothdex.net/x" }),
    ];
    const ranked = rankLinks(links, { languages: [], formats: [] }, HOSTS);
    expect(ranked.map((item) => item.index)).toEqual([2, 1, 3]);
    expect(ranked[1]?.reasons).toEqual(["host not allowed: evil.example"]);
  });
});

describe("isTrustedHost", () => {
  it.each([
    ["https://proxy.mothdex.net/f", true],
    ["https://PROXY.mothdex.net/f", true],
    ["http://proxy.mothdex.net/f", false],
    ["https://proxy.mothdex.net.evil.example/f", false],
    ["https://evil.example/proxy.mothdex.net", false],
    ["https://proxy.mothdex.net./f", true],
    ["https://proxy.mothdex.net:443/f", true],
    ["https://proxy.mothdex.net:8443/f", false],
    ["https://user:pw@proxy.mothdex.net/f", false],
    ["https://user@proxy.mothdex.net/f", false],
    ["not a url", false],
  ])("%s -> %s", (url, expected) => {
    expect(isTrustedHost(url, HOSTS)).toBe(expected);
  });
});

describe("TtlCache", () => {
  it("expires exactly at the TTL", () => {
    const clock = new FakeClock();
    const cache = new TtlCache<number>(clock);
    cache.set("a", 1, 1000);
    clock.nowMs += 999;
    expect(cache.get("a")).toBe(1);
    clock.nowMs += 1;
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts the least recently used item past the cap", () => {
    const cache = new TtlCache<number>(new FakeClock(), 2);
    cache.set("a", 1, 1000);
    cache.set("b", 2, 1000);
    cache.get("a");
    cache.set("c", 3, 1000);
    expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([1, undefined, 3]);
  });

  it("stores nothing for a TTL of 0", () => {
    const cache = new TtlCache<number>(new FakeClock());
    cache.set("a", 1, 0);
    expect(cache.size).toBe(0);
  });
});

describe("searchKey", () => {
  it("is the same for equivalent spellings and differs by page", () => {
    const a = searchKey({ searchKey: " Doom ", platforms: ["Dos", "gba", "dos"], page: 1 });
    const b = searchKey({ searchKey: "doom", platforms: ["gba", "dos"] });
    expect(a).toBe(b);
    expect(searchKey({ searchKey: "doom", platforms: ["dos", "gba"], page: 2 })).not.toBe(a);
  });
});

describe("toToolError", () => {
  const kind = (k: ConstructorParameters<typeof MothdexError>[0]["kind"], retryAfterMs = 0) =>
    toToolError(new MothdexError({ kind: k, op: "x", retryAfterMs }));

  it.each([
    ["not_found", "not_found", false],
    ["invalid_request", "invalid_request", false],
    ["network", "network", true],
    ["upstream", "upstream", true],
    ["api", "upstream", false],
    ["canceled", "canceled", false],
    ["decode", "api_incompatible", false],
    ["api_incompatible", "api_incompatible", false],
    ["untrusted_redirect", "untrusted_redirect", false],
  ] as const)("kind %s -> code %s, retryable %s", (from, code, retryable) => {
    expect(kind(from)).toMatchObject({ code, retryable });
  });

  it("rounds the cooldown up to whole seconds, only for rate_limited", () => {
    expect(kind("rate_limited", 1500)).toMatchObject({ retryable: true, retryAfterS: 2 });
    expect(kind("rate_limited", 0).retryAfterS).toBeUndefined();
  });

  it("hides what it does not know", () => {
    expect(toToolError(new Error("secret path /etc/x"))).toEqual({
      code: "internal",
      message: "unexpected internal error",
      retryable: false,
    });
    expect(toToolError(new InvalidRequest("bad"))).toMatchObject({ code: "invalid_request" });
  });
});

describe("loadConfig", () => {
  it("uses defaults, trims and lowercases the host list, and rejects a bad rate limit", () => {
    expect(loadConfig({})).toMatchObject({
      baseUrl: "https://api.mothdex.net/v1",
      rateLimit: undefined,
    });
    expect([...loadConfig({}).allowedHosts]).toEqual(["proxy.mothdex.net"]);
    expect([
      ...loadConfig({ MOTHDEX_ALLOWED_HOSTS: " A.example , ,B.example" }).allowedHosts,
    ]).toEqual(["a.example", "b.example"]);
    expect(loadConfig({ MOTHDEX_API_RATE_LIMIT: "3" }).rateLimit).toBe(3);
    expect(() => loadConfig({ MOTHDEX_API_RATE_LIMIT: "fast" })).toThrow("MOTHDEX_API_RATE_LIMIT");
  });
});

describe("parseMaxItems", () => {
  it.each([
    [undefined, 20],
    ["0", 1],
    ["500", 50],
    ["7", 7],
  ])("%s -> %s", (raw, expected) => {
    expect(parseMaxItems(raw)).toBe(expected);
  });
});
