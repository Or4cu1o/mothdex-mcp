import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NameRejected, sanitizeName } from "./sanitize";

interface Vector {
  name: string;
  input: string;
  allow_executable: boolean;
  fallback: { slug: string; format: string; job_id: string } | null;
  output: string | null;
  error: string | null;
}

const doc = JSON.parse(
  readFileSync(new URL("../testdata/sanitize-vectors.json", import.meta.url), "utf8"),
) as { version: number; vectors: Vector[] };

/** T-60 case 8 (and 9): every vector of mothdex-cli gives the same bytes here; the allow_executable one is unsafe_name. */
describe("Sanitize vectors shared with mothdex-cli", () => {
  it("is the version this port understands", () => {
    expect(doc.version).toBe(1);
  });
  const run = (v: Vector): string => {
    const fallback = v.fallback
      ? { slug: v.fallback.slug, format: v.fallback.format, jobId: v.fallback.job_id }
      : undefined;
    return sanitizeName(v.input, fallback);
  };
  it.each(doc.vectors.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    // There is no override in MCP: the vector that lifts the deny-list is unsafe_name here.
    if (v.error !== null || v.allow_executable) {
      expect(() => run(v)).toThrow(NameRejected);
      try {
        run(v);
      } catch (error) {
        expect((error as NameRejected).reason).toBe(v.allow_executable ? "unsafe_name" : v.error);
      }
    } else {
      expect(run(v)).toBe(v.output);
    }
  });
});

/** T-60 case 10: invariants and idempotence on hard inputs, with a seeded generator (no dependency). */
describe("Sanitize invariants", () => {
  const fallback = { slug: "slug", format: "zip", jobId: "jobid" };
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const alphabet = [..."ab.- _/\\:<>|?*\u0000\u001b‮​ é́ｘ／：COMcon¹😀\ud800"];
  const strings = [
    "con",
    "CON.",
    " con ",
    "..con..",
    "COM¹ .x",
    "con ".repeat(80),
    `${"a".repeat(190)}.CON`,
  ];
  const rand = seeded(7);
  for (let i = 0; i < 400; i++) {
    strings.push(
      Array.from(
        { length: Math.floor(rand() * 40) },
        () => alphabet[Math.floor(rand() * alphabet.length)],
      ).join(""),
    );
  }
  it("always gives one safe component that sanitizes to itself", () => {
    for (const raw of strings) {
      let name: string;
      try {
        name = sanitizeName(raw, fallback);
      } catch (error) {
        expect(error).toBeInstanceOf(NameRejected); // only an executable extension may refuse
        continue;
      }
      expect(Buffer.byteLength(name)).toBeLessThanOrEqual(200);
      expect(name).not.toMatch(/[<>:"/\\|?*\p{Cc}]/u);
      expect(name).not.toMatch(/^[. ]|[. ]$/);
      expect(sanitizeName(name, fallback)).toBe(name);
    }
  });
  it("cuts a long name on a character boundary and keeps a short extension", () => {
    for (const stem of ["a".repeat(300), "あ".repeat(100), "😀".repeat(75)]) {
      const name = sanitizeName(`${stem}.zip`);
      expect(Buffer.byteLength(name)).toBeLessThanOrEqual(200);
      expect(name.endsWith(".zip")).toBe(true);
      expect(name).not.toContain("�");
    }
  });
});
