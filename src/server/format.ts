import type * as z from "zod/v4";
import type { Entry, Link } from "../api";
import type { EntrySummary, LinkSummary } from "./schemas";

type EntrySummaryOut = z.infer<typeof EntrySummary>;
type LinkSummaryOut = z.infer<typeof LinkSummary>;

/** Compact entry: no links, only how many there are and their size range. */
export function entrySummary(entry: Entry): EntrySummaryOut {
  const sizes = entry.links.map((link) => link.size);
  return {
    slug: entry.slug,
    title: entry.title,
    platform: entry.platform,
    regions: [...entry.regions],
    ...(entry.serial === "" ? {} : { serial: entry.serial }),
    links_count: entry.links.length,
    ...(sizes.length === 0 ? {} : { size_range: [Math.min(...sizes), Math.max(...sizes)] }),
  };
}

export function linkSummary(link: Link, index: number): LinkSummaryOut {
  return {
    index,
    type: link.type,
    format: link.format,
    extras: [...link.extras],
    filename: link.filename,
    size: link.size,
    size_str: link.sizeStr,
    source_name: link.sourceName,
  };
}
