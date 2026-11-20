import { describe, expect, it } from "vitest";
import { MothdexClient } from "./client";
import { isMothdexError } from "./errors";
import { fixture, makeClient, ok } from "./test-helpers";

const fail = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

describe("retries and the 429 circuit", () => {
  it("retries upstream errors with backoff and then succeeds", async () => {
    const { client, clock, seen } = makeClient([{ status: 503 }, { status: 500 }, ok("info.json")]);
    await expect(client.info()).resolves.toMatchObject({ totalEntries: expect.any(Number) });
    expect(seen).toHaveLength(3);
    expect(clock.sleeps).toEqual([500, 1000]);
  });

  it("gives up after maxRetries with an upstream error", async () => {
    const { client, seen } = makeClient([{ status: 500 }], { maxRetries: 1 });
    const error = await fail(client.info());
    expect(isMothdexError(error) && error.kind).toBe("upstream");
    expect(seen).toHaveLength(2);
  });

  it("retries a network failure", async () => {
    const { client, seen } = makeClient([{ fail: new TypeError("fetch failed") }, ok("info.json")]);
    await client.info();
    expect(seen).toHaveLength(2);
  });

  it("retries a 429 once after Retry-After, then reports it", async () => {
    const limited = { status: 429, headers: { "retry-after": "3" } };
    const { client, clock, seen } = makeClient([limited, limited]);
    const error = await fail(client.info());
    expect(isMothdexError(error) && [error.kind, error.retryAfterMs]).toEqual([
      "rate_limited",
      3000,
    ]);
    expect(seen).toHaveLength(2);
    expect(clock.sleeps).toContain(3000);
  });

  it("opens a 10-minute cooldown on the third 429 and then makes no requests", async () => {
    const breaches: number[] = [];
    const { client, clock, seen } = makeClient([{ status: 429 }], {
      onBreach: (t) => breaches.push(t),
    });
    await fail(client.info()); // hits 1 and 2 (one retry)
    const third = await fail(client.info());
    expect(isMothdexError(third) && [third.kind, third.retryAfterMs]).toEqual([
      "rate_limited",
      600_000,
    ]);
    expect(breaches).toHaveLength(1);
    const sent = seen.length;
    const blocked = await fail(client.info());
    expect(isMothdexError(blocked) && blocked.kind).toBe("rate_limited");
    expect(seen).toHaveLength(sent);
    clock.nowMs += 600_001;
    await fail(client.info());
    expect(seen.length).toBeGreaterThan(sent); // the circuit closed: requests flow again
  });

  it("seeds the circuit from cooldownUntilMs", async () => {
    const { client, clock, seen } = makeClient([ok("info.json")], {
      cooldownUntilMs: 1_000_000 + 5000,
    });
    const error = await fail(client.info());
    expect(isMothdexError(error) && [error.kind, error.retryAfterMs]).toEqual([
      "rate_limited",
      5000,
    ]);
    expect(seen).toHaveLength(0);
    expect(clock.sleeps).toEqual([]);
  });

  it("spaces calls beyond the burst through the token bucket", async () => {
    const { client, clock } = makeClient([ok("info.json")], { rateLimit: 5, burst: 2 });
    await Promise.all([client.info(), client.info(), client.info()]);
    expect(clock.sleeps).toEqual([200]);
  });
});

describe("requests that never reach the API", () => {
  it.each([
    ["empty slug", (c: MothdexClient) => c.entry("")],
    ["non-string slug", (c: MothdexClient) => c.entry(42 as unknown as string)],
    ["slug over 256 bytes", (c: MothdexClient) => c.entry("é".repeat(129))],
    ["max_results over 100", (c: MothdexClient) => c.search({ searchKey: "x", maxResults: 101 })],
    ["negative page", (c: MothdexClient) => c.search({ searchKey: "x", page: -1 })],
    ["fractional page", (c: MothdexClient) => c.search({ searchKey: "x", page: 1.5 })],
    [
      "51 platforms",
      (c: MothdexClient) => c.random({ platforms: Array.from({ length: 51 }, String) }),
    ],
  ])("%s is invalid_request without a request", async (_name, call) => {
    const { client, seen } = makeClient([ok("info.json")]);
    const error = await fail(call(client));
    expect(isMothdexError(error) && error.kind).toBe("invalid_request");
    expect(seen).toHaveLength(0);
  });
});

describe("constructor options", () => {
  it.each([
    { rateLimit: Number.NaN },
    { rateLimit: Number.POSITIVE_INFINITY },
    { burst: Number.NaN },
    { maxRetries: Number.NaN },
    { timeoutMs: Number.POSITIVE_INFINITY },
    { timeoutMs: Number.NaN },
    { timeoutMs: 0 },
    { timeoutMs: 1.5 },
  ])("refuses %j", (options) => {
    expect(() => new MothdexClient(options)).toThrow(/^Error: mothdex: |^mothdex: /);
  });
});

describe("transport rules", () => {
  it.each([
    "http://api.mothdex.net/v1",
    "http://localhost:8080",
    "ftp://x.test",
    "https://user:pw@api.mothdex.net/v1",
    "https://api.mothdex.net/v1?x=1",
    "not a url",
  ])("refuses base URL %s without echoing it", (raw) => {
    expect(() => new MothdexClient({ baseUrl: raw })).toThrow(/mothdex: /);
    try {
      new MothdexClient({ baseUrl: raw });
    } catch (error) {
      expect(String(error)).not.toContain("pw");
    }
  });

  it("accepts http on a loopback IP literal and keeps the base path", async () => {
    const { client, seen } = makeClient([ok("info.json")], {
      baseUrl: "http://127.0.0.1:8080/v1/",
    });
    await client.info();
    expect(seen[0]?.url).toBe("http://127.0.0.1:8080/v1/info");
  });

  it("follows a same-origin redirect and refuses a cross-host one", async () => {
    const same = makeClient([{ status: 307, headers: { location: "/v1/info2" } }, ok("info.json")]);
    await same.client.info();
    expect(same.seen.map((s) => s.url)).toEqual([
      "https://api.mothdex.net/v1/info",
      "https://api.mothdex.net/v1/info2",
    ]);
    const cross = makeClient([{ status: 302, headers: { location: "https://evil.test/x" } }], {
      maxRetries: 0,
    });
    const error = await fail(cross.client.info());
    expect(isMothdexError(error) && error.kind).toBe("network");
    expect(cross.seen).toHaveLength(1);
  });

  it("drops content-type when a redirect turns the POST into a GET", async () => {
    const headersSeen: (string | null)[] = [];
    const answers = [
      new Response(null, { status: 302, headers: { location: "/v1/entry2" } }),
      new Response(fixture("entry.json")),
    ];
    const client = new MothdexClient({
      fetch: async (_url, init) => {
        headersSeen.push(new Headers(init.headers).get("content-type"));
        return answers.shift() ?? new Response("{}");
      },
    });
    await client.entry("doom-1993-dos");
    expect(headersSeen).toEqual(["application/json", null]);
  });

  it("refuses a body over 16 MiB", async () => {
    const big = { body: "x".repeat(16 * 1024 * 1024 + 1) };
    const error = await fail(makeClient([big]).client.info());
    expect(isMothdexError(error) && [error.kind, error.detail]).toEqual([
      "decode",
      "response body over 16 MiB",
    ]);
  });

  it("separates cancelation by the caller from a network failure", async () => {
    const controller = new AbortController();
    const aborting = { fail: new DOMException("aborted", "AbortError") };
    const { client } = makeClient([aborting], { maxRetries: 0 });
    controller.abort();
    const canceled = await fail(client.info(controller.signal));
    expect(isMothdexError(canceled) && canceled.kind).toBe("canceled");
    const net = await fail(makeClient([aborting], { maxRetries: 0 }).client.info());
    expect(isMothdexError(net) && net.kind).toBe("network");
  });

  it("strips control characters from info.error before it reaches a caller", async () => {
    const body = JSON.stringify({ info: { error: "bad\u001b[2Jthing‮" }, data: {} });
    const error = await fail(makeClient([{ body }]).client.info());
    expect(isMothdexError(error) && error.detail).toBe("bad[2Jthing");
  });

  it("sends a generic User-Agent and no user data", async () => {
    let agent = "";
    const client = new MothdexClient({
      fetch: async (_url, init) => {
        agent = new Headers(init.headers).get("user-agent") ?? "";
        return new Response(fixture("info.json"));
      },
    });
    await client.info();
    expect(agent).toMatch(/^mothdex-mcp\/\S+ \(\+https:\/\/github\.com\/Or4cu1o\/mothdex-mcp\)$/);
  });
});
