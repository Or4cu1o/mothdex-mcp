import { MothdexError } from "./errors";
import type { FetchFn } from "./options";
import { cleanMessage, MAX_BODY_BYTES } from "./parse";

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

export interface RawRequest {
  readonly op: string;
  readonly method: "GET" | "POST";
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly payload: string | undefined;
  readonly signal: AbortSignal;
}

/** Reads the body as UTF-8 text, refusing more than 16 MiB. */
async function readCapped(op: string, response: Response): Promise<string> {
  const tooBig = (): MothdexError =>
    new MothdexError({
      kind: "decode",
      op,
      httpStatus: response.status,
      detail: "response body over 16 MiB",
    });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw tooBig();
  }
  if (response.body === null) return "";
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooBig();
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** Where a redirect goes, or undefined when it is not followable (other host or scheme). */
function resolveTarget(from: URL, location: string | null): URL | undefined {
  if (location === null) return undefined;
  try {
    return new URL(location, from);
  } catch {
    return undefined;
  }
}

/** Why a redirect is refused, or undefined when it may be followed. Only the target host is named. */
function refusalDetail(target: URL | undefined, first: URL, hops: number): string | undefined {
  if (target === undefined) return "redirect without a usable target";
  if (target.origin !== first.origin) {
    return `redirect to ${cleanMessage(target.host)} refused`;
  }
  return hops >= MAX_REDIRECTS ? "too many redirects" : undefined;
}

/**
 * One HTTP exchange. Redirects are followed by hand, at most three and only inside the same
 * origin (scheme, host and port); anything else is "untrusted_redirect", as in the Go client. 301/302/303 turn into a body-less GET; 307/308 keep the request.
 */
export async function exchange(fetchFn: FetchFn, request: RawRequest): Promise<RawResponse> {
  let { method, url, payload, headers } = request;
  const first = url;
  for (let hops = 0; ; hops++) {
    const init: RequestInit = {
      method,
      headers,
      redirect: "manual",
      signal: request.signal,
      ...(payload === undefined ? {} : { body: payload }),
    };
    const response = await fetchFn(url, init);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return {
        status: response.status,
        headers: response.headers,
        text: await readCapped(request.op, response),
      };
    }
    await response.body?.cancel();
    const target = resolveTarget(url, response.headers.get("location"));
    const refusal = refusalDetail(target, first, hops);
    if (target === undefined || refusal !== undefined) {
      // Not retried and not a 429: kind "untrusted_redirect" is outside the retry rule.
      throw new MothdexError({
        kind: "untrusted_redirect",
        op: request.op,
        httpStatus: response.status,
        detail: refusal ?? "redirect without a usable target",
      });
    }
    url = target;
    if (response.status !== 307 && response.status !== 308) {
      method = "GET";
      payload = undefined;
      headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => name !== "content-type"),
      );
    }
  }
}
