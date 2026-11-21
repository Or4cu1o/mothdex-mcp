import { type DownloadLimits, MAX_COMPLETED, MAX_STARTED } from "./settings";

/** The key of the in-process name reservation (tools.md §3.4 step 5): NFC, full case folding. */
export const reservationKey = (name: string): string =>
  name.normalize("NFC").toUpperCase().toLowerCase();

/**
 * Process-wide state of `download_file`: the one active call, the budgets, the name reservations and
 * the space ledger. One instance lives as long as the server process, so a limit holds until restart.
 */
export class DownloadState {
  /** Aborted when stdin closes: in-flight transfers stop and clean up. */
  readonly shutdown = new AbortController();
  /** Staging files in use, for the last-resort cleanup at process exit. */
  readonly activeParts = new Set<string>();
  #active = false;
  #completed = 0;
  #started = 0;
  #bytesStarted = 0;
  #ledger = 0n;
  readonly #names = new Set<string>();

  /** Concurrency 1: false when a call is already running. */
  tryAcquire(): boolean {
    if (this.#active) return false;
    this.#active = true;
    return true;
  }

  release(): void {
    this.#active = false;
  }

  reserveName(name: string): boolean {
    const key = reservationKey(name);
    if (this.#names.has(key)) return false;
    this.#names.add(key);
    return true;
  }

  releaseName(name: string): void {
    this.#names.delete(reservationKey(name));
  }

  /** True when a transfer of `size` bytes still fits every budget of tools.md §3.6. */
  withinBudget(size: number, limits: DownloadLimits): boolean {
    return (
      this.#completed < MAX_COMPLETED &&
      this.#started < MAX_STARTED &&
      this.#bytesStarted + size <= limits.totalBytes
    );
  }

  noteStarted(size: number): void {
    this.#started++;
    this.#bytesStarted += size;
  }

  noteCompleted(): void {
    this.#completed++;
  }

  /** Bytes promised to calls in flight; the copy fallback needs twice the size. */
  get ledger(): bigint {
    return this.#ledger;
  }

  reserveBytes(bytes: bigint): void {
    this.#ledger += bytes;
  }

  releaseBytes(bytes: bigint): void {
    this.#ledger -= bytes;
  }
}
