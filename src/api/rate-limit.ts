/** Token bucket. Time is injected as milliseconds so tests never wait. */
export class TokenBucket {
  readonly #ratePerMs: number;
  readonly #burst: number;
  #tokens: number;
  #lastMs: number;

  constructor(ratePerSecond: number, burst: number, nowMs: number) {
    this.#ratePerMs = ratePerSecond / 1000;
    this.#burst = burst;
    this.#tokens = burst;
    this.#lastMs = nowMs;
  }

  /** Takes one token and returns how long to wait before using it (0 when one was free). */
  reserve(nowMs: number): number {
    this.#refill(nowMs);
    this.#tokens -= 1;
    return this.#tokens >= 0 ? 0 : Math.ceil(-this.#tokens / this.#ratePerMs);
  }

  /** Gives back a token reserved by a wait that was canceled. */
  refund(nowMs: number): void {
    this.#refill(nowMs);
    this.#tokens = Math.min(this.#tokens + 1, this.#burst);
  }

  #refill(nowMs: number): void {
    const elapsed = Math.max(nowMs - this.#lastMs, 0);
    this.#tokens = Math.min(this.#tokens + elapsed * this.#ratePerMs, this.#burst);
    this.#lastMs = nowMs;
  }
}
