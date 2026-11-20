import { isIP } from "node:net";

/** Loopback IP literals only; names such as "localhost" can be repointed. */
function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  if (family === 4) return host.startsWith("127.");
  return family === 6 && (host === "::1" || host === "0:0:0:0:0:0:0:1");
}

/**
 * Accepts https, or http for loopback hosts only, without credentials, query or fragment.
 * Error texts are fixed on purpose: a URL parse failure would quote the input, which may
 * hold a credential.
 */
export function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("mothdex: invalid base URL: not a valid URL");
  }
  if (
    url.host === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "mothdex: base URL must be scheme://host[/path] without credentials, query or fragment",
    );
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:") {
    if (isLoopback(url.hostname)) return url;
    throw new Error("mothdex: http base URL is only allowed for loopback hosts");
  }
  throw new Error("mothdex: base URL must use https");
}

/** Joins an API path onto the base URL path. */
export function joinPath(base: URL, path: string): URL {
  const url = new URL(base);
  url.pathname = `${base.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  return url;
}
