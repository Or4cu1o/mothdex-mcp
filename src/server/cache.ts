import type { Clock } from "../api";

export const MAX_CACHE_ITEMS = 500;

const HOUR_MS = 3_600_000;
/** TTLs from mothdex-cli docs/contracts/cli/cache.md §1. */
export const TTL_MS = {
  search: 24 * HOUR_MS,
  entry: 24 * HOUR_MS,
  meta: 7 * 24 * HOUR_MS,
  info: HOUR_MS,
} as const;

interface Item<V> {
  readonly value: V;
  readonly expiresAt: number;
}

/** In-memory LRU with a per-item TTL. A Map keeps insertion order, so the first key is the oldest. */
export class TtlCache<V> {
  readonly #items = new Map<string, Item<V>>();
  readonly #max: number;
  readonly #clock: Clock;

  constructor(clock: Clock, max: number = MAX_CACHE_ITEMS) {
    this.#clock = clock;
    this.#max = max;
  }

  get(key: string): V | undefined {
    const item = this.#items.get(key);
    if (item === undefined) return undefined;
    this.#items.delete(key);
    if (item.expiresAt <= this.#clock.now()) return undefined;
    this.#items.set(key, item);
    return item.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (ttlMs <= 0) return;
    this.#items.delete(key);
    this.#items.set(key, { value, expiresAt: this.#clock.now() + ttlMs });
    while (this.#items.size > this.#max) {
      const oldest = this.#items.keys().next();
      if (oldest.done) return;
      this.#items.delete(oldest.value);
    }
  }

  get size(): number {
    return this.#items.size;
  }
}
