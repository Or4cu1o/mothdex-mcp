import * as z from "zod/v4";
import { SAFE_SLUG } from "./operations";

/** Shared input fragments from docs/contracts/mcp/tools.md. */
export const Slug = z.string().regex(SAFE_SLUG);
export const Ids = z.array(z.string().regex(/^[a-z0-9_-]{1,32}$/)).max(20);
export const Query = z.string().trim().min(1).max(200);
export const PageSize = z.number().int().min(1).max(25).default(10);
export const Page = z.number().int().min(1).default(1);

export const FilterInput = {
  query: Query.optional(),
  platforms: Ids.optional(),
  regions: Ids.optional(),
  serial: z.string().max(64).optional(),
};

const Regions = z.array(z.string());

export const EntrySummary = z.object({
  slug: z.string(),
  title: z.string(),
  platform: z.string(),
  regions: Regions,
  serial: z.string().optional(),
  links_count: z.number().int(),
  size_range: z.tuple([z.number(), z.number()]).optional(),
});

export const LinkSummary = z.object({
  index: z.number().int(),
  type: z.string(),
  format: z.string(),
  extras: z.array(z.string()),
  filename: z.string(),
  size: z.number(),
  size_str: z.string(),
  source_name: z.string(),
});

export const DownloadLink = LinkSummary.extend({
  url: z.string(),
  source_url: z.string(),
  trusted_host: z.boolean(),
  reasons: z.array(z.string()),
});

/** Error body of a failed call: `structuredContent` with `isError: true`. */
export const ToolErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    retry_after_s: z.number().optional(),
  }),
});
