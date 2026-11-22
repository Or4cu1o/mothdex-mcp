// Checks the .mcpb icon file: a complete 512x512 PNG (signature, IHDR first, the exact size, the 12-byte IEND chunk at the
// end, so a truncated file fails). Used by check-package.mjs and by scripts/pack-mcpb.sh; run on its own:
//   node scripts/check-icon.mjs [path]      default: mcpb/icon.png
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from("0000000049454e44ae426082", "hex");

/** Returns a list of problems (empty when the file is a complete 512x512 PNG). */
export function iconProblems(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    return [`${path} is missing or unreadable`];
  }
  const problems = [];
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE))
    return [`${path} is not a PNG file`];
  if (bytes.toString("latin1", 12, 16) !== "IHDR")
    problems.push(`${path}: the first chunk is not IHDR`);
  if (bytes.readUInt32BE(16) !== 512 || bytes.readUInt32BE(20) !== 512)
    problems.push(`${path} must be 512x512`);
  if (!bytes.subarray(bytes.length - 12).equals(IEND))
    problems.push(`${path} does not end with the IEND chunk (truncated?)`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? fileURLToPath(new URL("../mcpb/icon.png", import.meta.url));
  const problems = iconProblems(path);
  for (const p of problems) console.error(p);
  if (problems.length > 0) process.exit(1);
  console.log(`icon ok: ${path}`);
}
