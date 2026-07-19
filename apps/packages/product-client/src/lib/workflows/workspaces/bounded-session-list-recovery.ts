export type BoundedSessionListRecoveryResult<T> =
  | { kind: "loaded"; sessions: T[]; recovered: boolean }
  | { kind: "failed" }
  | { kind: "stale" };

/**
 * Gives a transient session-directory miss one fresh retry, then stops. The
 * caller owns the explicit recovery UI after the bounded attempt is exhausted.
 */
export async function loadSessionsWithBoundedRecovery<T>(input: {
  forceInitialRefresh?: boolean;
  isCurrent: () => boolean;
  load: (forceRefresh: boolean) => Promise<T[]>;
}): Promise<BoundedSessionListRecoveryResult<T>> {
  try {
    const sessions = await input.load(input.forceInitialRefresh ?? false);
    if (!input.isCurrent()) {
      return { kind: "stale" };
    }
    if (sessions.length > 0) {
      return {
        kind: "loaded",
        sessions,
        recovered: false,
      };
    }
  } catch {
    // A failed first read and an empty cached read take the same single fresh
    // path. Only the forced result is authoritative enough to bootstrap an
    // actually empty workspace.
  }
  if (!input.isCurrent()) {
    return { kind: "stale" };
  }

  try {
    const sessions = await input.load(true);
    if (!input.isCurrent()) {
      return { kind: "stale" };
    }
    return {
      kind: "loaded",
      sessions,
      recovered: true,
    };
  } catch {
    return input.isCurrent() ? { kind: "failed" } : { kind: "stale" };
  }
}
