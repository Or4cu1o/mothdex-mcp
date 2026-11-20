import { describe, expect, it } from "vitest";
import { breachReached } from "./breaker";
import { classifyInfoError, classifyStatus, MothdexError } from "./errors";
import { cleanMessage, parseRetryAfter } from "./parse";
import { TokenBucket } from "./rate-limit";
import { backoffCeiling, INITIAL_RETRY_STATE, planRetry } from "./retry";

describe("error classification", () => {
  it.each([
    [{ error: "Entry not found", code: "" }, "not_found"],
    [{ error: "Slug is required", code: "" }, "invalid_request"],
    [{ error: "Invalid input provided", code: "" }, "invalid_request"],
    [{ error: "Database operation failed", code: "" }, "upstream"],
    [{ error: "A database error occurred", code: "" }, "upstream"],
    [{ error: "An unexpected error occurred", code: "" }, "upstream"],
    [{ error: "something new", code: "" }, "api"],
    [{ error: "Entry not found", code: "database_error" }, "upstream"],
    [{ error: "x", code: "unheard_of" }, "api"],
  ] as const)("info %j gives %s", (info, kind) => {
    expect(classifyInfoError(info)).toBe(kind);
  });

  it.each([
    [400, "invalid_request"],
    [404, "api_incompatible"],
    [429, "rate_limited"],
    [500, "upstream"],
    [418, "upstream"],
  ] as const)("HTTP %d gives %s", (status, kind) => {
    expect(classifyStatus(status)).toBe(kind);
  });
});

describe("server text and Retry-After", () => {
  it("strips Cc and Cf characters and bounds the length in bytes", () => {
    expect(cleanMessage("a\u001b[31mb‮c​d")).toBe("a[31mbcd");
    const long = cleanMessage("é".repeat(300));
    expect(Buffer.byteLength(long, "utf8")).toBeLessThanOrEqual(200);
    expect(long).not.toContain("�");
  });

  it.each([
    ["5", 0, 5_000],
    ["0", 0, 0],
    ["-3", 0, 0],
    ["", 0, 0],
    ["junk", 0, 0],
    ["999999999", 0, 24 * 3600_000],
    ["Thu, 01 Jan 1970 00:00:10 GMT", 4_000, 6_000],
    ["Jan 1 2026", 0, 0],
  ])("Retry-After %j at %d ms gives %d ms", (value, now, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });
});

describe("retry and circuit rules", () => {
  const upstream = new MothdexError({ kind: "upstream", op: "x" });
  const limited = (ms: number) =>
    new MothdexError({ kind: "rate_limited", op: "x", retryAfterMs: ms });
  const jitter = (max: number) => max;

  it("backs off 500 ms x 2^n capped at 8 s", () => {
    expect([0, 1, 4, 9].map(backoffCeiling)).toEqual([500, 1000, 8000, 8000]);
  });

  it("retries upstream up to maxRetries, then stops", () => {
    const first = planRetry(upstream, INITIAL_RETRY_STATE, 2, false, jitter);
    expect(first).toMatchObject({ retry: true, waitMs: 500 });
    if (!first.retry) throw new Error("unreachable");
    const second = planRetry(upstream, first.next, 2, false, jitter);
    expect(second).toMatchObject({ retry: true, waitMs: 1000 });
    if (!second.retry) throw new Error("unreachable");
    expect(planRetry(upstream, second.next, 2, false, jitter).retry).toBe(false);
  });

  it.each([
    ["no Retry-After waits 2 s", limited(0), false, { retry: true, waitMs: 2000 }],
    ["Retry-After is honored", limited(7000), false, { retry: true, waitMs: 7000 }],
    ["over 30 s is reported, not slept", limited(31_000), false, { retry: false }],
    ["an open circuit never retries", limited(1000), true, { retry: false }],
  ])("429: %s", (_name, error, open, expected) => {
    expect(planRetry(error, INITIAL_RETRY_STATE, 2, open, jitter)).toMatchObject(expected);
  });

  it("does not retry a second 429 on the same call", () => {
    expect(planRetry(limited(1000), { backoff: 0, rateLimit: 1 }, 2, false, jitter).retry).toBe(
      false,
    );
  });

  it("opens the circuit on the third hit", () => {
    expect(
      [
        [1, 2],
        [1, 2, 3],
      ].map(breachReached),
    ).toEqual([false, true]);
  });

  it("bucket allows the burst, then spaces requests at the rate", () => {
    const bucket = new TokenBucket(5, 5, 0);
    expect(Array.from({ length: 7 }, () => bucket.reserve(0))).toEqual([0, 0, 0, 0, 0, 200, 400]);
    bucket.refund(0);
    expect(bucket.reserve(0)).toBe(400);
  });
});
