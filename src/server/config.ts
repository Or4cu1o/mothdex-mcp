import { DEFAULT_BASE_URL } from "../api";

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ["proxy.mothdex.net"];

export interface ServerConfig {
  readonly baseUrl: string;
  /** Requests per second; the client clamps it to 1..10. */
  readonly rateLimit: number | undefined;
  readonly allowedHosts: ReadonlySet<string>;
}

/** Raised for a bad environment value; the message is safe to print and names only the variable. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function parseRateLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ConfigError("MOTHDEX_API_RATE_LIMIT must be a number");
  }
  return value;
}

function parseHosts(raw: string | undefined): ReadonlySet<string> {
  const hosts = (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");
  return new Set(hosts.length > 0 ? hosts : DEFAULT_ALLOWED_HOSTS);
}

/** Environment only (tools.md §1). The API base URL is validated by the client itself. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const baseUrl = env.MOTHDEX_API_BASE_URL?.trim();
  return {
    baseUrl: baseUrl === undefined || baseUrl === "" ? DEFAULT_BASE_URL : baseUrl,
    rateLimit: parseRateLimit(env.MOTHDEX_API_RATE_LIMIT),
    allowedHosts: parseHosts(env.MOTHDEX_ALLOWED_HOSTS),
  };
}
