/** T-27 / T-63: `Content-Length` is the size authority; `link.size` is a preflight estimate (T-60 cases 25, 30, 32, 37, 37b, 37c). */
import { describe, expect, it } from "vitest";
import { MIB, makeRig, type Rig, type RigOptions, rawLink } from "./test-kit";

const rigs: Rig[] = [];
const rig = (options?: RigOptions): Rig => {
  const r = makeRig(options);
  rigs.push(r);
  return r;
};
const code = async (call: Promise<unknown>): Promise<string> =>
  call.then(
    () => "no error",
    (error: { code?: string }) => error.code ?? "unknown",
  );
const GIB = 1024 * MIB;
const body = (n: number): string => "x".repeat(n);

describe("Content-Length as the size authority (T-27)", () => {
  it.each([
    ["missing", null],
    ["zero", "0"],
    ["a plus sign", "+5"],
    ["a decimal", "5.0"],
    ["an exponent", "1e3"],
    ["a leading zero", "05"],
    ["above the safe integers", "9007199254740993"],
  ])("case 25: a %s Content-Length is size_mismatch with the body unread", async (_l, length) => {
    const r = rig({
      replies: [
        {
          chunks: ["0123456789"],
          headers: length === null ? {} : { "content-length": length },
          length: null,
        },
      ],
    });
    expect(await code(r.run())).toBe("size_mismatch");
    expect(r.proxy.pulled[0]).toBe(0);
    expect(r.proxy.cancelled[0]).toBe(true);
    expect(r.files()).toEqual([]);
    expect(r.rt.state.ledger).toBe(0n);
  });

  it("case 25: above CL_UPPER_BAND (4 x link.size + 256 MiB) is size_mismatch, the band itself is accepted", async () => {
    const limits = {
      MOTHDEX_DOWNLOAD_MAX_FILE_BYTES: String(256 * GIB),
      MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES: String(1024 * GIB),
    };
    const band = 4 * 10 + 256 * MIB;
    const over = rig({ limits, replies: [{ chunks: [], length: band + 1 }] });
    expect(await code(over.run())).toBe("size_mismatch");
    expect(over.proxy.pulled[0]).toBe(0);
    const edge = rig({
      limits,
      fs: { freeBytes: async () => BigInt(2 ** 50) },
      replies: [{ chunks: [], length: band }],
    });
    // Accepted by the band: the call goes on to the body and fails only because the stream is empty.
    expect(await code(edge.run())).toBe("size_mismatch");
    expect(edge.rt.state.ledger).toBe(0n);
    expect(edge.logs.some((l) => l.includes("size drift"))).toBe(true); // it got past the band to the claim
  });

  it("case 25: a body of cl+1 bytes aborts at byte cl+1; a short body is size_mismatch", async () => {
    const long = rig({ replies: [{ chunks: [body(10), "A"], length: 10 }] });
    expect(await code(long.run())).toBe("size_mismatch");
    expect(long.files()).toEqual([]);
    const short = rig({ replies: [{ chunks: [body(5)], length: 10 }] });
    expect(await code(short.run())).toBe("size_mismatch");
    expect(short.files()).toEqual([]);
  });

  it.each([
    ["under half of link.size", 20, 9],
    ["3 x link.size", 20, 60],
  ])("case 25: cl at %s is done with one drift log line", async (_l, size, cl) => {
    const r = rig({
      links: [rawLink({ size })],
      replies: [{ chunks: [body(cl)] }],
    });
    const result = await r.run();
    expect(result).toMatchObject({ status: "done", bytes: cl });
    expect(r.logs.filter((l) => l.includes("size drift"))).toHaveLength(1);
  });

  it("case 25: a cl within 0.5x to 1.5x of link.size logs no drift", async () => {
    const r = rig({ links: [rawLink({ size: 20 })], replies: [{ chunks: [body(30)] }] });
    await r.run();
    expect(r.logs.filter((l) => l.includes("size drift"))).toEqual([]);
  });

  it("case 37: bytes and the progress total equal cl, not link.size", async () => {
    const seen: [number, number][] = [];
    const r = rig({
      links: [rawLink({ size: 20 })],
      replies: [{ chunks: [body(7), body(5)] }],
      onProgress: (bytes, total) => seen.push([bytes, total]),
    });
    expect((await r.run()).bytes).toBe(12);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(([, total]) => total === 12)).toBe(true);
  });

  it("case 37b: cl above the per-file cap, inside the band, is size_mismatch before the body", async () => {
    const r = rig({
      links: [rawLink({ size: 2 * MIB })],
      limits: {
        MOTHDEX_DOWNLOAD_MAX_FILE_BYTES: String(4 * MIB),
        MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES: String(64 * MIB),
      },
      replies: [{ chunks: [], length: 5 * MIB }],
    });
    expect(await code(r.run())).toBe("size_mismatch");
    expect(r.proxy.pulled[0]).toBe(0);
    expect(r.proxy.cancelled[0]).toBe(true);
    expect(r.files()).toEqual([]);
  });

  it("case 37c: a cl larger than link.size regrows the ledger claim to 2 x cl", async () => {
    let claim: bigint | undefined;
    const r = rig({
      links: [rawLink({ size: 10 })],
      replies: [{ chunks: [body(40)] }],
    });
    const state = r.rt.state;
    const reserve = state.reserveBytes.bind(state);
    state.reserveBytes = (bytes) => {
      claim = bytes;
      reserve(bytes);
    };
    expect((await r.run()).status).toBe("done");
    expect(claim).toBe(80n);
    expect(state.ledger).toBe(0n);
  });

  it("case 30: enough space for link.size but not for cl is disk_full after the headers, body unread, ledger released", async () => {
    let calls = 0;
    const free = 256n * BigInt(MIB) + 100n; // fits link.size 10 plus the margin, not cl 1 MiB
    const r = rig({
      links: [rawLink({ size: 10 })],
      replies: [{ chunks: [], length: MIB }],
      fs: {
        freeBytes: async () => {
          calls++;
          return free;
        },
      },
    });
    expect(await code(r.run())).toBe("disk_full");
    expect(calls).toBe(2);
    expect(r.proxy.urls).toHaveLength(1);
    expect(r.proxy.pulled[0]).toBe(0);
    expect(r.proxy.cancelled[0]).toBe(true);
    expect(r.rt.state.ledger).toBe(0n);
    expect(r.files()).toEqual([]);
    // The failed call stays charged with the estimate (10), not cl (1 MiB): the budget is not burnt.
    expect(r.rt.state.lengthFits(10, 10, { ...r.rt.limits, totalBytes: 10 })).toBe(true);
  });

  it("case 32: link.size fits the remaining budget but cl does not: quota_exceeded after the headers, body unread", async () => {
    const r = rig({
      links: [rawLink({ size: 10 })],
      limits: {
        MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES: String(2 * MIB),
        MOTHDEX_DOWNLOAD_MAX_FILE_BYTES: String(2 * MIB),
      },
      replies: [{ chunks: [], length: 2 * MIB }],
    });
    r.rt.state.noteStarted(MIB); // the remaining budget is just under 1 MiB: link.size 10 fits, cl does not
    expect(await code(r.run())).toBe("quota_exceeded");
    expect(r.proxy.pulled[0]).toBe(0);
    expect(r.proxy.cancelled[0]).toBe(true);
    expect(r.rt.state.ledger).toBe(0n);
  });

  it("case 32: the total budget is charged with cl, not the estimate", async () => {
    const r = rig({
      links: [
        rawLink({ size: 10, filename: "a.zip" }),
        rawLink({ size: 10, filename: "b.zip", url: "https://proxy.mothdex.net/file/b" }),
      ],
      limits: { MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES: String(MIB) },
      replies: [{ chunks: [body(MIB - 100)] }, { chunks: [body(200)] }],
    });
    expect((await r.run({ link_index: 1 })).status).toBe("done"); // charged MIB - 100, not 10
    expect(await code(r.run({ link_index: 2 }))).toBe("quota_exceeded"); // 200 more crosses the cap
  });
});
