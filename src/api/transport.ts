import { MothdexError } from "./errors";
import type { FetchFn } from "./options";
import { MAX_BODY_BYTES } from "./parse";

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
function sameOriginTarget(from: URL, location: string | null): URL | undefined {
  if (location === null) return undefined;
  let target: URL;
  try {
    target = new URL(location, from);
  } catch {
    return undefined;
  }
  return target.origin === from.origin ? target : undefined;
}

/**
 * One HTTP exchange. Redirects are followed by hand, at most three and only inside the same
 * origin, as in the Go client. 301/302/303 turn into a body-less GET; 307/308 keep the request.
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
    const target = sameOriginTarget(first, response.headers.get("location"));
    if (hops >= MAX_REDIRECTS || target === undefined) {
      throw new MothdexError({
        kind: "network",
        op: request.op,
        httpStatus: response.status,
        detail: "redirect refused",
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
