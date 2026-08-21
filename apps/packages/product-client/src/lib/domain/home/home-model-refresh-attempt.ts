/**
 * One Refresh press, counted per attempted harness kind.
 *
 * Counted rather than read off the mutation because a single `useMutation`
 * observer tracks only its most recent call: fire two kinds, have one refused
 * and one succeed, and `isError` reports whichever finished last. The user
 * would be told the refresh was refused because of start order.
 *
 * Outcomes must therefore be attributed from each call's own promise. That
 * observer keeps ONE `#mutateOptions` slot and removes the previous observer
 * on every `mutate`, so with N kinds only the LAST call's per-call callbacks
 * run — `settled` would stop at 1 while `attempted` was N, pinning the
 * in-flight sentence on screen forever and making the all-refused sentence
 * unreachable for N >= 2.
 */
export interface RefreshAttempt {
  attempted: number;
  settled: number;
  refused: number;
}

export const IDLE_REFRESH_ATTEMPT: RefreshAttempt = { attempted: 0, settled: 0, refused: 0 };

export function isRefreshInFlight(attempt: RefreshAttempt): boolean {
  return attempt.attempted > 0 && attempt.settled < attempt.attempted;
}

/** Refused only when NOTHING got through: one kind succeeding means the
 * refresh did something, whatever another kind answered. */
export function isRefreshRefused(attempt: RefreshAttempt): boolean {
  return attempt.attempted > 0
    && attempt.settled === attempt.attempted
    && attempt.refused === attempt.attempted;
}
