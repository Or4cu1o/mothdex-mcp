import { MothdexError } from "./errors";
import type { Filters, SearchRequest } from "./types";

const MAX_SLUG_BYTES = 256;
const MAX_RESULTS_CAP = 100;
const MAX_FILTER_LIST = 50;

function invalid(op: string, detail: string): MothdexError {
  return new MothdexError({ kind: "invalid_request", op, detail });
}

export function validateSlug(op: string, slug: string): void {
  if (typeof slug !== "string") throw invalid(op, "slug must be a string");
  if (slug === "") throw invalid(op, "slug is required");
  if (Buffer.byteLength(slug, "utf8") > MAX_SLUG_BYTES) {
    throw invalid(op, `slug longer than ${MAX_SLUG_BYTES} bytes`);
  }
}

export function validateFilters(op: string, filters: Filters): void {
  if ((filters.platforms?.length ?? 0) > MAX_FILTER_LIST) {
    throw invalid(op, `more than ${MAX_FILTER_LIST} platforms`);
  }
  if ((filters.regions?.length ?? 0) > MAX_FILTER_LIST) {
    throw invalid(op, `more than ${MAX_FILTER_LIST} regions`);
  }
}

export function validateSearch(op: string, request: SearchRequest): void {
  const { maxResults = 0, page = 0 } = request;
  if (!Number.isInteger(maxResults) || maxResults < 0 || maxResults > MAX_RESULTS_CAP) {
    throw invalid(op, `max_results must be 0..${MAX_RESULTS_CAP}`);
  }
  if (!Number.isInteger(page) || page < 0) throw invalid(op, "page must be >= 0");
  validateFilters(op, request);
}

/** Wire body of the filters: empty values are omitted, like the Go client's omitempty. */
export function filtersBody(filters: Filters): Record<string, unknown> {
  return {
    ...(filters.searchKey ? { search_key: filters.searchKey } : {}),
    ...(filters.platforms?.length ? { platforms: filters.platforms } : {}),
    ...(filters.regions?.length ? { regions: filters.regions } : {}),
    ...(filters.serial ? { serial: filters.serial } : {}),
  };
}

export function searchBody(request: SearchRequest): Record<string, unknown> {
  return {
    ...filtersBody(request),
    ...(request.maxResults ? { max_results: request.maxResults } : {}),
    ...(request.page ? { page: request.page } : {}),
  };
}
