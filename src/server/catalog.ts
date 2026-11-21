import type {
  DbInfo,
  Entry,
  Filters,
  MothdexClient,
  Platform,
  Region,
  SearchRequest,
  SearchResponse,
} from "../api";
import { TTL_MS, type TtlCache } from "./cache";

/** Sorted, lowercased and de-duplicated, so equivalent requests share a cache key. */
const canonicalList = (values: readonly string[] | undefined): string[] =>
  [...new Set((values ?? []).map((value) => value.toLowerCase()))].sort();

/** Pure: the same search by another spelling gives the same key (cache.md §2). */
export function searchKey(request: SearchRequest): string {
  return JSON.stringify({
    max: request.maxResults ?? 0,
    page: request.page ?? 1,
    platforms: canonicalList(request.platforms),
    regions: canonicalList(request.regions),
    q: (request.searchKey ?? "").trim().toLowerCase(),
    serial: request.serial ?? "",
  });
}

/** The client behind an in-memory cache. `random` is never cached. */
export class Catalog {
  readonly #client: MothdexClient;
  readonly #cache: TtlCache<unknown>;

  constructor(client: MothdexClient, cache: TtlCache<unknown>) {
    this.#client = client;
    this.#cache = cache;
  }

  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    return this.#cached(`search:${searchKey(request)}`, TTL_MS.search, () =>
      this.#client.search(request, signal),
    );
  }

  entry(slug: string, signal?: AbortSignal): Promise<Entry> {
    return this.#cached(`entry:${slug}`, TTL_MS.entry, () => this.#client.entry(slug, signal));
  }

  random(filters: Filters, signal?: AbortSignal): Promise<Entry> {
    return this.#client.random(filters, signal);
  }

  platforms(signal?: AbortSignal): Promise<Platform[]> {
    return this.#cached("platforms", TTL_MS.meta, () => this.#client.platforms(signal));
  }

  regions(signal?: AbortSignal): Promise<Region[]> {
    return this.#cached("regions", TTL_MS.meta, () => this.#client.regions(signal));
  }

  info(signal?: AbortSignal): Promise<DbInfo> {
    return this.#cached("info", TTL_MS.info, () => this.#client.info(signal));
  }

  async #cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.#cache.get(key);
    if (hit !== undefined) return hit as T;
    const value = await load();
    this.#cache.set(key, value, ttlMs);
    return value;
  }
}
