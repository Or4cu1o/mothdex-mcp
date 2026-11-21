import { type Entry, type Filters, MothdexError } from "../api";
import type { Catalog } from "./catalog";
import { InvalidRequest } from "./errors";
import { entrySummary, linkSummary } from "./format";
import { pickLink, type RankedLink, rankLinks } from "./links";

/** What every operation needs; `signal` is the request's cancellation. */
export interface Env {
  readonly catalog: Catalog;
  readonly allowedHosts: ReadonlySet<string>;
  readonly signal?: AbortSignal;
  /** One line for the operator (stderr); never carries API text. */
  readonly warn?: (message: string) => void;
}

/**
 * Slugs from the API end up in command lines the model prints, so only this shape is passed on:
 * lowercase words and digits joined by dashes (Sentinela, PR #8). Anything else is untrusted data.
 */
export const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,255}$/;

/** The entry as answered, or a decode failure (api_incompatible) when its slug is not a safe one. */
export function checkedEntry(op: string, entry: Entry): Entry {
  if (!SAFE_SLUG.test(entry.slug)) {
    throw new MothdexError({ kind: "decode", op, detail: "entry slug has an unexpected form" });
  }
  return entry;
}

export interface FilterArgs {
  readonly query?: string | undefined;
  readonly platforms?: readonly string[] | undefined;
  readonly regions?: readonly string[] | undefined;
  readonly serial?: string | undefined;
}

const hasFilter = (args: FilterArgs): boolean =>
  args.query !== undefined ||
  (args.platforms?.length ?? 0) > 0 ||
  (args.regions?.length ?? 0) > 0 ||
  (args.serial !== undefined && args.serial !== "");

function toFilters(args: FilterArgs): Filters {
  return {
    ...(args.query === undefined ? {} : { searchKey: args.query }),
    ...(args.platforms === undefined ? {} : { platforms: args.platforms }),
    ...(args.regions === undefined ? {} : { regions: args.regions }),
    ...(args.serial === undefined ? {} : { serial: args.serial }),
  };
}

export async function searchEntries(
  env: Env,
  args: FilterArgs & { page: number; page_size: number },
) {
  if (!hasFilter(args)) {
    throw new InvalidRequest("give at least one of query, platforms, regions or serial");
  }
  const response = await env.catalog.search(
    { ...toFilters(args), maxResults: args.page_size, page: args.page },
    env.signal,
  );
  const safe = response.results.filter((entry) => SAFE_SLUG.test(entry.slug));
  const dropped = response.results.length - safe.length;
  if (dropped > 0) env.warn?.(`search dropped ${dropped} entries with an unsafe slug`);
  const empty = response.totalResults === 0;
  return {
    page: empty ? 1 : response.currentPage,
    total_pages: empty ? 0 : response.totalPages,
    total_results: response.totalResults,
    results: safe.map(entrySummary),
  };
}

export async function getEntry(env: Env, args: { slug: string; offset: number; limit: number }) {
  const entry = checkedEntry("entry", await env.catalog.entry(args.slug, env.signal));
  const page = entry.links.slice(args.offset, args.offset + args.limit);
  return {
    entry: {
      ...entrySummary(entry),
      ...(entry.coverUrl === "" ? {} : { cover_url: entry.coverUrl }),
    },
    links: page.map((link, position) => linkSummary(link, args.offset + position + 1)),
    links_total: entry.links.length,
  };
}

export async function randomEntry(env: Env, args: FilterArgs) {
  const entry = checkedEntry("random", await env.catalog.random(toFilters(args), env.signal));
  return { entry: entrySummary(entry) };
}

export interface PlatformFilter {
  readonly class?: string | undefined;
  readonly brand?: string | undefined;
  readonly query?: string | undefined;
}

export async function listPlatforms(env: Env, filter: PlatformFilter) {
  const sameText = (a: string, b: string | undefined): boolean =>
    b === undefined || a.toLowerCase() === b.toLowerCase();
  const needle = filter.query?.toLowerCase();
  const platforms = await env.catalog.platforms(env.signal);
  return {
    platforms: platforms
      .filter(
        (platform) =>
          sameText(platform.class, filter.class) &&
          sameText(platform.brand, filter.brand) &&
          (needle === undefined ||
            platform.id.toLowerCase().includes(needle) ||
            platform.name.toLowerCase().includes(needle)),
      )
      .map(({ id, name, brand, class: platformClass }) => ({
        id,
        name,
        brand,
        class: platformClass,
      })),
  };
}

export async function listRegions(env: Env) {
  const regions = await env.catalog.regions(env.signal);
  return { regions: regions.map(({ id, name }) => ({ id, name })) };
}

export async function dbInfo(env: Env) {
  const info = await env.catalog.info(env.signal);
  return { total_entries: info.totalEntries };
}

export interface ResolveArgs {
  readonly slug: string;
  readonly link_index?: number | undefined;
  readonly prefer?:
    | { languages?: string[] | undefined; formats?: string[] | undefined }
    | undefined;
  readonly limit: number;
}

export async function resolveDownload(env: Env, args: ResolveArgs) {
  const entry = checkedEntry("entry", await env.catalog.entry(args.slug, env.signal));
  const preference = {
    languages: args.prefer?.languages ?? [],
    formats: args.prefer?.formats ?? [],
  };
  let chosen: RankedLink[];
  if (args.link_index === undefined) {
    chosen = rankLinks(entry.links, preference, env.allowedHosts).slice(0, args.limit);
  } else {
    const picked = pickLink(entry.links, args.link_index, env.allowedHosts);
    if (picked === undefined) {
      throw new InvalidRequest(
        `link_index ${args.link_index} is out of range (1..${entry.links.length})`,
      );
    }
    chosen = [picked];
  }
  return {
    entry: { slug: entry.slug, title: entry.title, platform: entry.platform },
    links: chosen.map(({ index, link, trustedHost, reasons }) => ({
      ...linkSummary(link, index),
      url: link.url,
      source_url: link.sourceUrl,
      trusted_host: trustedHost,
      reasons: [...reasons],
    })),
  };
}
