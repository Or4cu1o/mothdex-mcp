import type { Link } from "../api";

export interface Preference {
  readonly languages: readonly string[];
  readonly formats: readonly string[];
}

export interface RankedLink {
  /** 1-based position in API order; stable for an entry. */
  readonly index: number;
  readonly link: Link;
  readonly trustedHost: boolean;
  readonly reasons: readonly string[];
}

/**
 * True for https URLs on the default port, without credentials, whose host (one trailing dot
 * ignored) is in the allowlist. Same strictness as the CLI downloader's URL policy.
 */
export function isTrustedHost(url: string, allowedHosts: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      (parsed.port === "" || parsed.port === "443") &&
      allowedHosts.has(host)
    );
  } catch {
    return false;
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "unparsable URL";
  }
};

const hostReasons = (link: Link, trustedHost: boolean): string[] =>
  trustedHost ? [] : [`host not allowed: ${hostOf(link.url)}`];

/** One link by its 1-based index, whatever its type; undefined when out of range. */
export function pickLink(
  links: readonly Link[],
  index: number,
  allowedHosts: ReadonlySet<string>,
): RankedLink | undefined {
  const link = links[index - 1];
  if (link === undefined) return undefined;
  const trustedHost = isTrustedHost(link.url, allowedHosts);
  return {
    index,
    link,
    trustedHost,
    reasons: ["explicit link_index", ...hostReasons(link, trustedHost)],
  };
}

const NOT_FOUND = Number.MAX_SAFE_INTEGER;

/** Extras are free text such as "En,Fr" or "En Fr": tokens split on commas and spaces. */
const extraTokens = (extras: readonly string[]): string[] =>
  extras.flatMap((extra) => extra.toLowerCase().split(/[,\s]+/)).filter((token) => token !== "");

function firstLanguage(link: Link, languages: readonly string[]): number {
  const tokens = extraTokens(link.extras);
  const positions = languages.map((language) => tokens.indexOf(language.toLowerCase()));
  const hit = positions.findIndex((position) => position >= 0);
  return hit < 0 ? NOT_FOUND : hit;
}

function formatPosition(link: Link, formats: readonly string[]): number {
  const position = formats.findIndex(
    (format) => format.toLowerCase() === link.format.toLowerCase(),
  );
  return position < 0 ? NOT_FOUND : position;
}

/**
 * Link ranking of mothdex-cli app-service.md §3, without the source and size steps (the tool has
 * no input for them): keep `Game` links when there are any, then sort stably by preferred
 * language, then preferred format, then API order. Links on a host outside the allowlist stay in
 * the answer, flagged, after every trusted one.
 */
export function rankLinks(
  links: readonly Link[],
  preference: Preference,
  allowedHosts: ReadonlySet<string>,
): RankedLink[] {
  const indexed = links.map((link, position) => ({ link, index: position + 1 }));
  const games = indexed.filter(({ link }) => link.type === "Game");
  const candidates = games.length > 0 ? games : indexed;
  const ranked = candidates.map(({ link, index }) => {
    const trustedHost = isTrustedHost(link.url, allowedHosts);
    const language = firstLanguage(link, preference.languages);
    const format = formatPosition(link, preference.formats);
    const reasons = [
      ...(language === NOT_FOUND ? [] : [`language: ${preference.languages[language]}`]),
      ...(format === NOT_FOUND ? [] : [`format: ${preference.formats[format]}`]),
      ...hostReasons(link, trustedHost),
    ];
    return { index, link, trustedHost, reasons, language, format };
  });
  ranked.sort(
    (a, b) =>
      Number(b.trustedHost) - Number(a.trustedHost) ||
      a.language - b.language ||
      a.format - b.format ||
      a.index - b.index,
  );
  return ranked.map(({ index, link, trustedHost, reasons }) => ({
    index,
    link,
    trustedHost,
    reasons,
  }));
}
