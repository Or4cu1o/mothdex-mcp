/**
 * Gaps in size-authority.test.ts found by hand mutation of the T-27 guards (mothdex-mcp#23): each test
 * fails when the guard it names is removed or loosened, which the earlier tests do not.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MIB, makeRig, type Rig, type RigOptions, rawLink } from "./test-kit";

const rigs: Rig[] = [];
const rig = (options?: RigOptions): Rig => {
  const r = makeRig(options);
  rigs.push(r);
  return r;
};
afterEach(() => {
  for (const r of rigs.splice(0)) r.cleanup();
});
const code = async (call: Promise<unknown>): Promise<string> =>
  call.then(
    () => "no error",
    (error: { code?: string }) => error.code ?? "unknown",
  );
const GIB = 1024 * MIB;
const body = (n: number): string => "x".repeat(n);

describe("T-27 band: CL_UPPER_BAND = 4 x link.size + 256 MiB is enforced before the body", () => {
  const limits = {
    MOTHDEX_DOWNLOAD_MAX_FILE_BYTES: String(256 * GIB),
    MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES: String(1024 * GIB),
  };
  const size = GIB; // far from 0, so a wrong factor or floor moves the edge by gigabytes
  const band = 4 * size + 256 * MIB;

  it("one byte above the band: refused by the band itself (body cancelled unread, no space re-check, no drift line)", async () => {
    let freeCalls = 0;
    const r = rig({
      limits,
      links: [rawLink({ size })],
      fs: {
        freeBytes: async () => {
          freeCalls++;
          return BigInt(2 ** 60);
        },
      },
      replies: [{ chunks: [], length: band + 1 }],
    });
    expect(await code(r.run())).toBe("size_mismatch");
    expect(freeCalls).toBe(1); // only the preflight: the length never reached the space re-check
    expect(r.proxy.cancelled[0]).toBe(true);
    expect(r.logs.some((l) => l.includes("size drift"))).toBe(false);
    expect(r.rt.state.ledger).toBe(0n);
  });

  it("exactly the band: accepted, the claim is regrown (the space is re-checked, one drift line)", async () => {
    let freeCalls = 0;
    const r = rig({
      limits,
      links: [rawLink({ size })],
      fs: {
        freeBytes: async () => {
          freeCalls++;
          return BigInt(2 ** 60);
        },
      },
      replies: [{ chunks: [], length: band }],
    });
    // The stream is empty, so the call fails at the end of the body, not at the headers.
    expect(await code(r.run())).toBe("size_mismatch");
    expect(freeCalls).toBe(2);
    expect(r.logs.filter((l) => l.includes("size drift"))).toHaveLength(1);
  });
});

describe("T-27 ledger: the call's own claim is not counted against itself", () => {
  it("free space of exactly link.size + margin is enough when cl equals link.size", async () => {
    const size = 10 * MIB;
    const margin = 256 * MIB; // max(5 %, 256 MiB)
    const r = rig({
      links: [rawLink({ size })],
      fs: { freeBytes: async () => BigInt(size + margin) },
      replies: [{ chunks: [body(size)] }],
    });
    expect((await r.run()).status).toBe("done");
    expect(r.rt.state.ledger).toBe(0n);
  });
});

describe("T-27 drift and budget edges", () => {
  it("cl of exactly half of link.size logs no drift line", async () => {
    const r = rig({ links: [rawLink({ size: 20 })], replies: [{ chunks: [body(10)] }] });
    expect((await r.run()).bytes).toBe(10);
    expect(r.logs.filter((l) => l.includes("size drift"))).toEqual([]);
  });

  it("the budget keeps only cl once the length is known: the next call may use exactly the rest", async () => {
    const r = rig({
      links: [
        rawLink({ size: 10, filename: "a.zip" }),
        rawLink({ size: 10, filename: "b.zip", url: "https://proxy.mothdex.net/file/b" }),
      ],
      limits: { MOTHDEX_DOWNLOAD_MAX_TOTAL_BYTES: String(MIB) },
      replies: [{ chunks: [body(MIB - 100)] }, { chunks: [body(100)] }],
    });
    expect((await r.run({ link_index: 1 })).status).toBe("done");
    // Exactly 100 bytes are left: the estimate of the first call (10) must not stay charged.
    expect((await r.run({ link_index: 2 })).status).toBe("done");
  });
});
