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

  return { shouldBackfill: true, displayName };
}
