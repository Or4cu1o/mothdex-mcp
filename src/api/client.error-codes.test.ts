import { describe, expect, it } from "vitest";
import { MothdexError } from "./errors";
import { makeClient } from "./test-helpers";

const reply = (
  info: unknown,
  extra: { status?: number; headers?: Record<string, string> } = {},
) => ({
  status: extra.status ?? 200,
  headers: extra.headers,
  body: JSON.stringify({ info, data: {} }),
});

async function fail(promise: Promise<unknown>): Promise<MothdexError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MothdexError) return error;
    throw error;
  }
  throw new Error("expected a MothdexError");
}

describe("upstream error codes (HTTP 200, info.error is a code)", () => {
  it.each([
    ["ENTRY_NOT_FOUND", "not_found"],
    ["INVALID_API_VERSION", "api_incompatible"],
    ["MALFORMED_JSON", "invalid_request"],
    ["INVALID_JSON_OBJECT", "invalid_request"],
    ["MISSING_REQUIRED_FIELDS", "invalid_request"],
    ["INVALID_FIELD_TYPE", "invalid_request"],
    ["INVALID_INPUT", "invalid_request"],
  ] as const)("%s is %s and is not retried", async (code, kind) => {
    const { client, seen } = makeClient([reply({ error: code, message: "text of the day" })]);
    const error = await fail(client.entry("doom-1993-dos"));
    expect(error).toMatchObject({ kind, code, httpStatus: 200, detail: "text of the day" });
    expect(seen).toHaveLength(1);
  });

  it.each(["DB_OPERATION_ERROR", "DB_ERROR", "UNEXPECTED_ERROR"])(
    "%s is upstream and retried within the budget",
    async (code) => {
      const { client, seen } = makeClient([reply({ error: code, message: "m" })]);
      const error = await fail(client.info());
      expect(error.kind).toBe("upstream");
      expect(seen.length).toBeGreaterThan(1);
    },
  );

  it("RATE_LIMIT_ERROR follows the 429 rules: Retry-After is waited once, then reported", async () => {
    const limited = reply(
      { error: "RATE_LIMIT_ERROR", message: "slow down" },
      { headers: { "retry-after": "3" } },
    );
    const { client, clock, seen } = makeClient([limited, limited]);
    const error = await fail(client.info());
    expect(error).toMatchObject({
      kind: "rate_limited",
      code: "RATE_LIMIT_ERROR",
      retryAfterMs: 3000,
    });
    expect(seen).toHaveLength(2);
    expect(clock.sleeps).toContain(3000);
  });

  it("RATE_LIMIT_ERROR counts toward the breach circuit like a 429", async () => {
    const limited = reply({ error: "RATE_LIMIT_ERROR", message: "x" });
    const { client } = makeClient([limited]);
    await fail(client.info());
    await fail(client.info());
    const third = await fail(client.info());
    expect(third.kind).toBe("rate_limited");
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it("HTTP_ERROR on a 200 and an unknown code are the generic api kind, not retried", async () => {
    for (const code of ["HTTP_ERROR", "BRAND_NEW_CODE"]) {
      const { client, seen } = makeClient([reply({ error: code, message: "m" })]);
      const error = await fail(client.info());
      expect(error).toMatchObject({ kind: "api", code });
      expect(seen).toHaveLength(1);
    }
  });

  it("info.code is ignored", async () => {
    const { client } = makeClient([
      reply({ error: "ENTRY_NOT_FOUND", message: "m", code: "database_error" }),
    ]);
    expect((await fail(client.entry("doom-1993-dos"))).kind).toBe("not_found");
    const { client: other } = makeClient([reply({ error: "", code: "entry_not_found" })]);
    await expect(other.info()).rejects.toMatchObject({ kind: "decode" }); // no error and an empty data: not an API v1 answer
  });

  it("the message is cleaned and capped at 512 bytes, and the code is never taken from the message", async () => {
    const message = `a${String.fromCharCode(0x1b)}[31m${String.fromCharCode(0x202e)}${"é".repeat(600)}`;
    const { client } = makeClient([reply({ error: "INVALID_INPUT", message })]);
    const error = await fail(client.entry("doom-1993-dos"));
    expect(Buffer.byteLength(error.detail, "utf8")).toBeLessThanOrEqual(512);
    expect(error.detail).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    const { client: second } = makeClient([
      reply({ error: "INVALID_INPUT", message: "ENTRY_NOT_FOUND" }),
    ]);
    expect((await fail(second.entry("doom-1993-dos"))).kind).toBe("invalid_request");
  });

  it("info.error that is not a string is api_incompatible (decode)", async () => {
    for (const info of [{ error: 7 }, { error: { x: 1 } }, { error: null }]) {
      const { client } = makeClient([reply(info)]);
      expect((await fail(client.info())).kind).toBe("decode");
    }
  });
});

describe("the old form still works", () => {
  it("a message in info.error maps through the old table and keeps the text as the detail", async () => {
    const { client } = makeClient([reply({ error: "Entry not found" })]);
    expect(await fail(client.entry("doom-1993-dos"))).toMatchObject({
      kind: "not_found",
      code: "",
      detail: "Entry not found",
    });
  });

  it("an unknown old message is the generic api kind", async () => {
    const { client } = makeClient([reply({ error: "something new" })]);
    expect((await fail(client.info())).kind).toBe("api");
  });
});

describe("non-200 answers: the status decides", () => {
  it("400 with INVALID_API_VERSION is api_incompatible", async () => {
    const { client } = makeClient([
      reply({ error: "INVALID_API_VERSION", message: "use v1" }, { status: 400 }),
    ]);
    expect(await fail(client.info())).toMatchObject({
      kind: "api_incompatible",
      code: "INVALID_API_VERSION",
    });
  });

  it.each([
    [400, "MALFORMED_JSON", "invalid_request"],
    [500, "ENTRY_NOT_FOUND", "upstream"],
    [404, "DB_ERROR", "api_incompatible"],
    [429, "HTTP_ERROR", "rate_limited"],
  ] as const)(
    "HTTP %d with %s stays %s (the code is only recorded)",
    async (status, code, kind) => {
      const { client } = makeClient([reply({ error: code, message: "m" }, { status })]);
      expect(await fail(client.info())).toMatchObject({ kind, code, httpStatus: status });
    },
  );

  it("400 carries the message as detail", async () => {
    const { client } = makeClient([
      reply({ error: "MISSING_REQUIRED_FIELDS", message: "slug is missing" }, { status: 400 }),
    ]);
    expect((await fail(client.entry("doom-1993-dos"))).detail).toBe("slug is missing");
  });
});
