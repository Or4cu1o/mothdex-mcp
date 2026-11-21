/**
 * Byte-exact port of `Sanitize` from mothdex-cli (internal/proxy/sanitize.go, downloader.md §6.1,
 * T-16 §5): an untrusted file name becomes one safe path component, or an error. Same rules on every
 * platform, no override of the executable deny-list. The shared vectors in
 * `src/server/testdata/sanitize-vectors.json` pin the behavior.
 */

const MAX_NAME_BYTES = 200;
const MAX_EXT_BYTES = 16;
const FORBIDDEN = '<>:"/\\|?*';
const FORMAT_RE = /^[a-z0-9]{1,10}$/;
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u;

/** Windows device names (upper case), enforced everywhere. */
const RESERVED: ReadonlySet<string> = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CONIN$",
  "CONOUT$",
  ...[..."0123456789¹²³"].flatMap((digit) => [`COM${digit}`, `LPT${digit}`]),
]);

/** Last extensions (lower case) that a launcher or a double click may run. `bin` is a ROM extension. */
const EXECUTABLE_EXT: ReadonlySet<string> = new Set(
  `sh bash zsh csh ksh fish command run desktop appimage py pl rb jar
   exe com scr pif bat cmd ps1 psm1 psd1 vbs vbe js jse wsf wsh hta msi msp msc cpl dll lnk url reg scf
   inf library-ms settingcontent-ms appref-ms`
    .split(/\s+/)
    .filter((ext) => ext !== ""),
);

export type NameFailure = "unsafe_name" | "empty_name";

/** Why a name was refused. `unsafe_name` is an executable extension; `empty_name` is nothing left. */
export class NameRejected extends Error {
  readonly reason: NameFailure;
  constructor(reason: NameFailure) {
    super(reason);
    this.name = "NameRejected";
    this.reason = reason;
  }
}

export interface NameFallback {
  readonly slug: string;
  readonly format: string;
  readonly jobId: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const isBlank = (text: string): boolean => trimSet(text, "._ ", true, true) === "";

function trimSet(text: string, set: string, left: boolean, right: boolean): string {
  let start = 0;
  let end = text.length;
  while (left && start < end && set.includes(text[start] as string)) start++;
  while (right && end > start && set.includes(text[end - 1] as string)) end--;
  return text.slice(start, end);
}

/** Step 1: the last non-empty element after splitting on / and \. */
function lastComponent(raw: string): string {
  const parts = raw.split(/[/\\]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? "";
}

/** Step 2: invisible and format runes go, look-alikes of the separators and the colon become "_", NFC. */
function dropUnsafeRunes(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0) as number;
    if (code === 0xfffd || INVISIBLE.test(char)) continue;
    if (code < 0x80) out += char;
    else if (/[/\\:]/.test(char.normalize("NFKC"))) out += "_";
    else out += char;
  }
  return out.normalize("NFC");
}

/** Step 3, including the collapse of runs of "_" and of spaces. */
function replaceForbidden(text: string): string {
  let out = "";
  let last = "";
  for (let char of text) {
    const code = char.codePointAt(0) as number;
    if (FORBIDDEN.includes(char) || code < 0x20 || code === 0x7f) char = "_";
    if ((char === "_" || char === " ") && char === last) continue;
    out += char;
    last = char;
  }
  return out;
}

/** Step 4. */
function trimEdges(text: string): string {
  let current = text;
  for (;;) {
    const next = trimSet(trimSet(current, ". -", true, false), ". ", false, true);
    if (next === current) return current;
    current = next;
  }
}

/** Step 5. */
function prefixReserved(text: string): string {
  const stem = text.split(".", 1)[0] as string;
  return RESERVED.has(trimSet(stem, " ", false, true).toUpperCase()) ? `_${text}` : text;
}

/** Step 6: at most 200 bytes, the stem cut on a character boundary, a short extension kept. */
function capLength(text: string): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= MAX_NAME_BYTES) return text;
  const dot = bytes.lastIndexOf(0x2e);
  const extLength = dot > 0 && bytes.length - dot <= MAX_EXT_BYTES ? bytes.length - dot : 0;
  let cut = MAX_NAME_BYTES - extLength;
  while (cut > 0 && ((bytes[cut] as number) & 0xc0) === 0x80) cut--;
  return (
    decoder.decode(bytes.slice(0, cut)) + decoder.decode(bytes.slice(bytes.length - extLength))
  );
}

/** Steps 1 to 6. */
function cleanName(raw: string): string {
  let text = replaceForbidden(dropUnsafeRunes(lastComponent(raw)));
  for (let round = 0; round < 8; round++) {
    const next = capLength(prefixReserved(trimEdges(text)));
    if (next === text) break;
    text = next;
  }
  return text;
}

function fallbackName(fallback: NameFallback): string {
  const stem = cleanName(fallback.slug);
  if (isBlank(stem)) return "";
  return FORMAT_RE.test(fallback.format) ? `${stem}.${fallback.format}` : stem;
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1);
};

/** Step 9: the invariants, checked at run time. */
function invariantsHold(name: string): boolean {
  return !(
    name === "" ||
    name === "." ||
    name === ".." ||
    encoder.encode(name).length > MAX_NAME_BYTES ||
    [...FORBIDDEN].some((char) => name.includes(char)) ||
    INVISIBLE.test(name)
  );
}

/** A single safe path component, or `NameRejected`. Pure. */
export function sanitizeName(raw: string, fallback?: NameFallback): string {
  let name = cleanName(raw);
  if (isBlank(name)) {
    name = fallback === undefined ? "" : cleanName(fallbackName(fallback));
    if (isBlank(name)) {
      if (fallback === undefined || fallback.jobId === "") throw new NameRejected("empty_name");
      name = cleanName(`download-${fallback.jobId}`);
    }
  }
  if (EXECUTABLE_EXT.has(extOf(name).toLowerCase())) throw new NameRejected("unsafe_name");
  if (!invariantsHold(name)) throw new NameRejected("unsafe_name");
  return name;
}
