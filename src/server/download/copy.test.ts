import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { codeOf, copyExclusive } from "./fs-seam";

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "mothdex-copy-"));

/** The exclusive copy used when `link` is not available (Alicerce S1: no partial final file). */
describe("copyExclusive", () => {
  it("copies the bytes", async () => {
    const base = dir();
    fs.writeFileSync(path.join(base, "src"), "0123456789");
    await copyExclusive(path.join(base, "src"), path.join(base, "dst"));
    expect(fs.readFileSync(path.join(base, "dst"), "utf8")).toBe("0123456789");
  });

  it("a copy that fails midway leaves no final file", async () => {
    const base = dir();
    fs.writeFileSync(path.join(base, "src"), "0123456789");
    const full = (): never => {
      throw Object.assign(new Error("full"), { code: "ENOSPC" });
    };
    const error = await copyExclusive(path.join(base, "src"), path.join(base, "dst"), full).catch(
      (e: unknown) => e,
    );
    expect(codeOf(error)).toBe("ENOSPC");
    expect(fs.existsSync(path.join(base, "dst"))).toBe(false);
  });

  it("an existing name is EEXIST and is left exactly as it was", async () => {
    const base = dir();
    fs.writeFileSync(path.join(base, "src"), "new");
    fs.writeFileSync(path.join(base, "dst"), "mine");
    const error = await copyExclusive(path.join(base, "src"), path.join(base, "dst")).catch(
      (e: unknown) => e,
    );
    expect(codeOf(error)).toBe("EEXIST");
    expect(fs.readFileSync(path.join(base, "dst"), "utf8")).toBe("mine");
  });
});
