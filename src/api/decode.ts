import { MothdexError } from "./errors";
import type {
  DbInfo,
  Entry,
  Hashes,
  HashScope,
  Link,
  Platform,
  Region,
  SearchResponse,
} from "./types";

/** A value in "data" has the wrong type or a required key is missing. */
class ShapeError extends Error {}

type Obj = Record<string, unknown>;

function asObject(value: unknown, what: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ShapeError(`${what} must be an object`);
  }
  return value as Obj;
}

/** Required key: present and not null. */
function required(obj: Obj, key: string): unknown {
  const value = obj[key];
  if (value === undefined || value === null) throw new ShapeError(`expected key missing: ${key}`);
  return value;
}

/** Null or missing gives "", any other non-string is a shape error. */
function optString(obj: Obj, key: string): string {
  const value = obj[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ShapeError(`${key} must be a string`);
  return value;
}

function optNumber(obj: Obj, key: string): number {
  const value = obj[key];
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ShapeError(`${key} must be an integer`);
  }
  return value;
}

/** Null or missing gives []. */
function optStringList(obj: Obj, key: string): string[] {
  const value = obj[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ShapeError(`${key} must be a list of strings`);
  }
  return value as string[];
}

function optList(obj: Obj, key: string): unknown[] {
  const value = obj[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ShapeError(`${key} must be a list`);
  return value;
}

function decodeHashes(raw: unknown): Hashes | undefined {
  if (raw === undefined || raw === null) return undefined;
  const obj = asObject(raw, "hashes");
  const scope = obj.scope;
  if (scope !== "file" && scope !== "content") return undefined;
  const crc32 = optString(obj, "crc32").toLowerCase();
  const md5 = optString(obj, "md5").toLowerCase();
  const sha1 = optString(obj, "sha1").toLowerCase();
  return {
    scope: scope satisfies HashScope,
    ...(crc32 === "" ? {} : { crc32 }),
    ...(md5 === "" ? {} : { md5 }),
    ...(sha1 === "" ? {} : { sha1 }),
  };
}

function decodeLink(raw: unknown): Link {
  const obj = asObject(raw, "link");
  const hashes = decodeHashes(obj.hashes);
  return {
    type: optString(obj, "type"),
    extras: optStringList(obj, "extras"),
    format: optString(obj, "format"),
    filename: optString(obj, "filename"),
    url: optString(obj, "url"),
    size: optNumber(obj, "size"),
    sizeStr: optString(obj, "size_str"),
    sourceName: optString(obj, "source_name"),
    sourceUrl: optString(obj, "source_url"),
    ...(hashes === undefined ? {} : { hashes }),
  };
}

function decodeEntry(raw: unknown): Entry {
  const obj = asObject(raw, "entry");
  return {
    slug: optString(obj, "slug"),
    title: optString(obj, "title"),
    platform: optString(obj, "platform"),
    regions: optStringList(obj, "regions"),
    serial: optString(obj, "serial"),
    coverUrl: optString(obj, "cover_url"),
    links: optList(obj, "links").map(decodeLink),
  };
}

function byId(a: { id: string }, b: { id: string }): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function decodeSearch(data: unknown): SearchResponse {
  const obj = asObject(data, "data");
  if (!Array.isArray(required(obj, "results"))) throw new ShapeError("results must be a list");
  return {
    results: optList(obj, "results").map(decodeEntry),
    currentResults: optNumber(obj, "current_results"),
    totalResults: optNumber(obj, "total_results"),
    currentPage: optNumber(obj, "current_page"),
    totalPages: optNumber(obj, "total_pages"),
  };
}

function decodePlatforms(data: unknown): Platform[] {
  const map = asObject(required(asObject(data, "data"), "platforms"), "platforms");
  return Object.entries(map)
    .map(([id, raw]) => {
      const obj = asObject(raw, "platform");
      return {
        id,
        name: optString(obj, "name"),
        brand: optString(obj, "brand"),
        class: optString(obj, "class"),
      };
    })
    .sort(byId);
}

function decodeRegions(data: unknown): Region[] {
  const map = asObject(required(asObject(data, "data"), "regions"), "regions");
  return Object.entries(map)
    .map(([id, name]) => {
      if (typeof name !== "string") throw new ShapeError("region name must be a string");
      return { id, name };
    })
    .sort(byId);
}

function decodeInfo(data: unknown): DbInfo {
  const obj = asObject(data, "data");
  required(obj, "total_entries");
  return { totalEntries: optNumber(obj, "total_entries") };
}

function decodeEntryData(data: unknown): Entry {
  return decodeEntry(required(asObject(data, "data"), "entry"));
}

/** Runs a decoder; a wrong shape or a missing expected key becomes a "decode" error. */
function guarded<T>(op: string, decoder: (data: unknown) => T): (data: unknown) => T {
  return (data) => {
    try {
      return decoder(data);
    } catch (error) {
      if (!(error instanceof ShapeError)) throw error;
      throw new MothdexError({
        kind: "decode",
        op,
        httpStatus: 200,
        detail: "unexpected data shape",
        cause: error,
      });
    }
  };
}

export const decodeSearchData = guarded("search", decodeSearch);
export const decodeEntryResponse = (op: "entry" | "random") => guarded(op, decodeEntryData);
export const decodePlatformsData = guarded("platforms", decodePlatforms);
export const decodeRegionsData = guarded("regions", decodeRegions);
export const decodeInfoData = guarded("info", decodeInfo);
