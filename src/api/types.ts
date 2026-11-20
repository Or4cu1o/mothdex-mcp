/** Entry of the database. Unknown JSON fields are ignored; every string is external input. */
export interface Entry {
  readonly slug: string;
  readonly title: string;
  readonly platform: string;
  readonly regions: readonly string[];
  /** "" when null */
  readonly serial: string;
  /** "" when null; external URL, untrusted */
  readonly coverUrl: string;
  readonly links: readonly Link[];
}

export type HashScope = "file" | "content";

/** Proposed optional upstream field (U2). Hex strings are lowercased. */
export interface Hashes {
  readonly crc32?: string;
  readonly md5?: string;
  readonly sha1?: string;
  readonly scope: HashScope;
}

export interface Link {
  readonly type: string;
  readonly extras: readonly string[];
  readonly format: string;
  /** never use as a path without sanitization */
  readonly filename: string;
  /** host is checked by the consumer, not here */
  readonly url: string;
  /** bytes; authoritative expected size */
  readonly size: number;
  readonly sizeStr: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  /** future upstream field; undefined today */
  readonly hashes?: Hashes;
}

/** `id` comes from the key of the API map. */
export interface Platform {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly class: string;
}

export interface Region {
  readonly id: string;
  readonly name: string;
}

export interface DbInfo {
  readonly totalEntries: number;
}

export interface Filters {
  readonly searchKey?: string;
  readonly platforms?: readonly string[];
  readonly regions?: readonly string[];
  /** exact match */
  readonly serial?: string;
}

export interface SearchRequest extends Filters {
  /** undefined or 0 = API default (100); valid 1..100 */
  readonly maxResults?: number;
  /** undefined or 0 = 1 */
  readonly page?: number;
}

/**
 * Returned raw: the API may answer page 0 of 0 when nothing matches and clamps a page past the
 * last one. The caller normalizes.
 */
export interface SearchResponse {
  readonly results: readonly Entry[];
  readonly currentResults: number;
  readonly totalResults: number;
  readonly currentPage: number;
  readonly totalPages: number;
}
