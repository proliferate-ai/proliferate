/**
 * Shared reconnect backoff policy for session-stream connections.
 *
 * Both the primary session stream (session-stream-connection-open.ts /
 * session-reconnect-state.ts) and the Agents-pane detail stream
 * (use-agents-pane-session-lifecycle.ts) reconnect a dropped stream on the
 * same curve: base 350ms, doubling per attempt, capped at 15s, with jitter so
 * many sessions reconnecting at once do not all retry in lockstep.
 *
 * This module is pure domain logic (no timers, no module-level maps): callers
 * own their own attempt counters and `setTimeout` bookkeeping and just ask
 * this policy for "what is the shape of attempt N".
 */

export const RECONNECT_BACKOFF_BASE_DELAY_MS = 350;
export const RECONNECT_BACKOFF_FACTOR = 2;
export const RECONNECT_BACKOFF_CAP_MS = 15_000;

/** Jitter is a fraction of the un-jittered delay added on top, e.g. 0.2 = up to +20%. */
const RECONNECT_BACKOFF_JITTER_RATIO = 0.2;

export interface ReconnectBackoffState {
  /** 0-based count of reconnect attempts made since the last successful open. */
  attempt: number;
  /** Delay in ms before the next reconnect attempt fires. */
  nextDelayMs: number;
  /** True whenever a reconnect attempt has been scheduled and has not yet succeeded. */
  reconnecting: boolean;
}

/**
 * Un-jittered delay for a given 0-based attempt index: base * factor^attempt,
 * capped. Exposed separately so tests can assert the exact curve without
 * randomness in the mix.
 */
export function reconnectBackoffDelayForAttempt(attempt: number): number {
  const raw = RECONNECT_BACKOFF_BASE_DELAY_MS * RECONNECT_BACKOFF_FACTOR ** attempt;
  return Math.min(raw, RECONNECT_BACKOFF_CAP_MS);
}

/**
 * Delay for a given attempt with jitter applied. `rng` defaults to
 * Math.random and must be injected in tests to make the result
 * deterministic-testable (a `() => 0` rng yields the bare curve).
 */
export function reconnectBackoffDelayWithJitter(
  attempt: number,
  rng: () => number = Math.random,
): number {
  const base = reconnectBackoffDelayForAttempt(attempt);
  const jitter = base * RECONNECT_BACKOFF_JITTER_RATIO * rng();
  return Math.min(Math.round(base + jitter), RECONNECT_BACKOFF_CAP_MS);
}

/**
 * Advances a reconnect backoff state by one attempt, returning the next
 * state (including the delay to schedule). Callers persist the returned
 * state (per-session map, ref, etc.) and pass it back in on the next call.
 */
export function advanceReconnectBackoff(
  state: Pick<ReconnectBackoffState, "attempt"> | null | undefined,
  rng: () => number = Math.random,
): ReconnectBackoffState {
  const attempt = state?.attempt ?? 0;
  const nextDelayMs = reconnectBackoffDelayWithJitter(attempt, rng);
  return {
    attempt: attempt + 1,
    nextDelayMs,
    reconnecting: true,
  };
}

/** Reset state after a successful open. */
export function resetReconnectBackoff(): ReconnectBackoffState {
  return { attempt: 0, nextDelayMs: RECONNECT_BACKOFF_BASE_DELAY_MS, reconnecting: false };
}
