import { isRetryableKind, type MothdexError } from "./errors";

const MAX_RATE_LIMIT_RETRIES = 1;
const DEFAULT_RETRY_AFTER_MS = 2_000;
/** A longer Retry-After is reported to the caller, not slept. */
const MAX_AUTO_WAIT_MS = 30_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

export interface RetryState {
  /** upstream and network retries already spent */
  readonly backoff: number;
  /** 429 retries already spent */
  readonly rateLimit: number;
}

export type RetryPlan =
  | { readonly retry: false }
  | { readonly retry: true; readonly waitMs: number; readonly next: RetryState };

export const INITIAL_RETRY_STATE: RetryState = { backoff: 0, rateLimit: 0 };

/** min(cap, 500 ms * 2^n): the upper bound of the full jitter. */
export function backoffCeiling(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
}

function planRateLimited(error: MothdexError, state: RetryState, breakerOpen: boolean): RetryPlan {
  if (breakerOpen || state.rateLimit >= MAX_RATE_LIMIT_RETRIES) return { retry: false };
  const waitMs = error.retryAfterMs > 0 ? error.retryAfterMs : DEFAULT_RETRY_AFTER_MS;
  if (waitMs > MAX_AUTO_WAIT_MS) return { retry: false };
  return { retry: true, waitMs, next: { ...state, rateLimit: state.rateLimit + 1 } };
}

/**
 * The pure retry rule. It never sleeps and never reads a clock. `jitter(max)` returns a value
 * in [0, max] and is injected so tests are exact.
 */
export function planRetry(
  error: MothdexError,
  state: RetryState,
  maxRetries: number,
  breakerOpen: boolean,
  jitter: (maxMs: number) => number,
): RetryPlan {
  if (error.kind === "rate_limited") return planRateLimited(error, state, breakerOpen);
  if (isRetryableKind(error.kind) && state.backoff < maxRetries) {
    return {
      retry: true,
      waitMs: jitter(backoffCeiling(state.backoff)),
      next: { ...state, backoff: state.backoff + 1 },
    };
  }
  return { retry: false };
}
