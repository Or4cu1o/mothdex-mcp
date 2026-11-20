const BREACH_THRESHOLD = 3;
const BREACH_WINDOW_MS = 10 * 60 * 1000;
export const BREACH_COOLDOWN_MS = 10 * 60 * 1000;

/** The pure rule: the third 429 inside the window opens the circuit. */
export function breachReached(hits: readonly number[]): boolean {
  return hits.length >= BREACH_THRESHOLD;
}

/**
 * Counts HTTP 429 answers and opens a cooldown after repeated breaches. It lives in memory:
 * the MCP server is long-lived, so no persistence is needed.
 */
export class Breaker {
  #hits: readonly number[] = [];
  #until: number;

  constructor(seedUntilMs = 0) {
    this.#until = seedUntilMs;
  }

  /** How long the circuit stays open at `nowMs`, or 0 when closed. */
  remaining(nowMs: number): number {
    return Math.max(this.#until - nowMs, 0);
  }

  /** Registers a 429 seen at `nowMs`; returns the cooldown end when this hit opened the circuit. */
  record(nowMs: number): number | undefined {
    const hits = [...this.#hits.filter((hit) => nowMs - hit < BREACH_WINDOW_MS), nowMs];
    if (!breachReached(hits)) {
      this.#hits = hits;
      return undefined;
    }
    this.#hits = [];
    this.#until = nowMs + BREACH_COOLDOWN_MS;
    return this.#until;
  }
}
