import { readFileSync } from "node:fs";
import { MothdexClient } from "./client";
import type { ClientOptions, FetchFn } from "./options";

const FIXTURES = new URL("./testdata/api-v1/", import.meta.url);

export function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURES), "utf8");
}

export interface Scripted {
  readonly status?: number;
  readonly body?: string;
  readonly headers?: Record<string, string>;
  /** Throw instead of answering. */
  readonly fail?: Error;
}

export interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly body: string | undefined;
}

export class FakeClock {
  nowMs = 1_000_000;
  readonly sleeps: number[] = [];
  readonly now = (): number => this.nowMs;
  /** A sleeper that advances the clock instead of waiting. */
  readonly sleeper = async (ms: number): Promise<void> => {
    this.sleeps.push(ms);
    this.nowMs += ms;
  };
}

/** A fetch that answers the scripted responses in order and records what it saw. */
export function scriptedFetch(script: readonly Scripted[]): {
  fetch: FetchFn;
  seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  let index = 0;
  const fetch: FetchFn = async (input, init) => {
    seen.push({
      method: String(init.method),
      url: input.toString(),
      body: typeof init.body === "string" ? init.body : undefined,
    });
    const step = script[Math.min(index++, script.length - 1)];
    if (step === undefined) throw new Error("empty script");
    if (step.fail) throw step.fail;
    return new Response(step.body ?? "{}", { status: step.status ?? 200, headers: step.headers });
  };
  return { fetch, seen };
}

export function makeClient(script: readonly Scripted[], extra: ClientOptions = {}) {
  const clock = new FakeClock();
  const { fetch, seen } = scriptedFetch(script);
  const client = new MothdexClient({
    fetch,
    clock,
    sleeper: clock.sleeper,
    jitter: (max) => max,
    ...extra,
  });
  return { client, clock, seen };
}

export const ok = (name: string): Scripted => ({ body: fixture(name) });
