// Named exception (does not sit on the `cadence` scale): 2s falls strictly
// between `cadence.fastMs` (1s) and `cadence.standardMs` (5s). This retries a
// silent background backfill of a blank cloud workspace's display name;
// snapping down to fast would tighten (forbidden), and snapping up to
// standard would leave a freshly created workspace showing a blank name for
// noticeably longer in the sidebar/header — the exact visible-staleness
// surface the ADR calls out for this class of sync, even though the user
// isn't actively watching this particular retry loop resolve (UX Latency +
// Transitions ADR §4.7, Rung 6, Q8).
export const CLOUD_DISPLAY_NAME_SYNC_RETRY_INTERVAL_MS = 2_000;

export interface CloudDisplayNameSyncState {
  key: string;
  completed: boolean;
  lastAttemptAtMs: number | null;
}

export function resolveCloudDisplayNameSyncAttempt(input: {
  state: CloudDisplayNameSyncState | null;
  syncKey: string;
  nowMs: number;
  inFlight: boolean;
}): {
  state: CloudDisplayNameSyncState;
  shouldAttempt: boolean;
} {
  const state = input.state?.key === input.syncKey
    ? input.state
    : {
      key: input.syncKey,
      completed: false,
      lastAttemptAtMs: null,
    };

  if (state.completed || input.inFlight) {
    return { state, shouldAttempt: false };
  }

  if (
    state.lastAttemptAtMs !== null
    && input.nowMs - state.lastAttemptAtMs < CLOUD_DISPLAY_NAME_SYNC_RETRY_INTERVAL_MS
  ) {
    return { state, shouldAttempt: false };
  }

  return {
    state: {
      ...state,
      lastAttemptAtMs: input.nowMs,
    },
    shouldAttempt: true,
  };
}

export function markCloudDisplayNameSyncCompleted(
  state: CloudDisplayNameSyncState,
  syncKey: string,
): CloudDisplayNameSyncState {
  if (state.key !== syncKey) {
    return state;
  }

  return {
    ...state,
    completed: true,
  };
}

export function shouldBackfillCloudDisplayNameFromRuntime(input: {
  runtimeDisplayName: string | null | undefined;
  runtimeWorkspaceId?: string | null | undefined;
  backfillSuppressed: boolean;
}): {
  shouldBackfill: boolean;
  displayName: string | null;
} {
  if (input.backfillSuppressed) {
    return { shouldBackfill: false, displayName: null };
  }

  const displayName = input.runtimeDisplayName?.trim() ?? "";
  if (!displayName) {
    return { shouldBackfill: false, displayName: null };
  }

  const runtimeWorkspaceId = input.runtimeWorkspaceId?.trim() ?? "";
  if (runtimeWorkspaceId && displayName === runtimeWorkspaceId) {
    return { shouldBackfill: false, displayName: null };
  }

  return { shouldBackfill: true, displayName };
}
