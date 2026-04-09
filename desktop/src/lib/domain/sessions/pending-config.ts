import type {
  NormalizedSessionControl,
  NormalizedSessionControls,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";

export type PendingSessionConfigChangeStatus = "submitting" | "queued";

export interface PendingSessionConfigChange {
  rawConfigId: string;
  value: string;
  status: PendingSessionConfigChangeStatus;
  mutationId: number;
}

export type PendingSessionConfigChanges = Record<string, PendingSessionConfigChange>;

export interface ReconcilePendingConfigChangesResult {
  pendingConfigChanges: PendingSessionConfigChanges;
  reconciledChanges: PendingSessionConfigChange[];
}

export interface DisplayedSessionControlState {
  currentValue: string | null;
  pendingState: PendingSessionConfigChangeStatus | null;
}

export function getPendingSessionConfigChange(
  pendingConfigChanges: PendingSessionConfigChanges | null | undefined,
  rawConfigId: string | null | undefined,
): PendingSessionConfigChange | null {
  if (!pendingConfigChanges || !rawConfigId) {
    return null;
  }

  return pendingConfigChanges[rawConfigId] ?? null;
}

export function resolveDisplayedSessionControlState(
  control: NormalizedSessionControl,
  pendingConfigChanges: PendingSessionConfigChanges | null | undefined,
): DisplayedSessionControlState {
  const pendingChange = getPendingSessionConfigChange(
    pendingConfigChanges,
    control.rawConfigId,
  );

  return {
    currentValue: pendingChange?.value ?? control.currentValue ?? null,
    pendingState: pendingChange?.status ?? null,
  };
}

export function getAuthoritativeConfigValue(
  liveConfig: SessionLiveConfigSnapshot | null | undefined,
  rawConfigId: string | null | undefined,
): string | null {
  if (!liveConfig || !rawConfigId) {
    return null;
  }

  const control = findNormalizedSessionControlByRawConfigId(
    liveConfig.normalizedControls,
    rawConfigId,
  );
  if (control?.currentValue != null) {
    return control.currentValue;
  }

  return liveConfig.rawConfigOptions.find((option) => option.id === rawConfigId)?.currentValue ?? null;
}

export function findNormalizedSessionControlByRawConfigId(
  normalizedControls: NormalizedSessionControls | null | undefined,
  rawConfigId: string | null | undefined,
): NormalizedSessionControl | null {
  if (!normalizedControls || !rawConfigId) {
    return null;
  }

  const directControls: Array<NormalizedSessionControl | null | undefined> = [
    normalizedControls.model,
    normalizedControls.collaborationMode,
    normalizedControls.mode,
    normalizedControls.reasoning,
    normalizedControls.effort,
    normalizedControls.fastMode,
  ];

  return directControls.find((control) => control?.rawConfigId === rawConfigId)
    ?? normalizedControls.extras.find((control) => control.rawConfigId === rawConfigId)
    ?? null;
}

export function reconcilePendingConfigChanges(
  liveConfig: SessionLiveConfigSnapshot | null | undefined,
  pendingConfigChanges: PendingSessionConfigChanges | null | undefined,
): ReconcilePendingConfigChangesResult {
  if (!pendingConfigChanges || Object.keys(pendingConfigChanges).length === 0) {
    return {
      pendingConfigChanges: pendingConfigChanges ?? {},
      reconciledChanges: [],
    };
  }

  const nextPendingConfigChanges: PendingSessionConfigChanges = {};
  const reconciledChanges: PendingSessionConfigChange[] = [];

  for (const [rawConfigId, pendingChange] of Object.entries(pendingConfigChanges)) {
    if (getAuthoritativeConfigValue(liveConfig, rawConfigId) === pendingChange.value) {
      reconciledChanges.push(pendingChange);
      continue;
    }

    nextPendingConfigChanges[rawConfigId] = pendingChange;
  }

  return {
    pendingConfigChanges: nextPendingConfigChanges,
    reconciledChanges,
  };
}

export function collectFailedQueuedChanges(
  liveConfig: SessionLiveConfigSnapshot | null | undefined,
  pendingConfigChanges: PendingSessionConfigChanges | null | undefined,
): PendingSessionConfigChange[] {
  if (!pendingConfigChanges) {
    return [];
  }

  return Object.values(pendingConfigChanges).filter((pendingChange) =>
    pendingChange.status === "queued"
    && getAuthoritativeConfigValue(liveConfig, pendingChange.rawConfigId) !== pendingChange.value,
  );
}

export function snapshotQueuedPendingConfigMutationIds(
  pendingConfigChanges: PendingSessionConfigChanges | null | undefined,
): Record<string, number> {
  if (!pendingConfigChanges) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(pendingConfigChanges)
      .filter(([, pendingChange]) => pendingChange.status === "queued")
      .map(([rawConfigId, pendingChange]) => [rawConfigId, pendingChange.mutationId]),
  );
}

export function collectFailedQueuedChangesMatchingMutationIds(
  liveConfig: SessionLiveConfigSnapshot | null | undefined,
  pendingConfigChanges: PendingSessionConfigChanges | null | undefined,
  expectedMutationIds: Record<string, number>,
): PendingSessionConfigChange[] {
  return collectFailedQueuedChanges(liveConfig, pendingConfigChanges).filter((pendingChange) =>
    expectedMutationIds[pendingChange.rawConfigId] === pendingChange.mutationId,
  );
}

export function hasQueuedPendingConfigChanges(
  pendingConfigChanges: PendingSessionConfigChanges | null | undefined,
): boolean {
  if (!pendingConfigChanges) {
    return false;
  }

  return Object.values(pendingConfigChanges).some((pendingChange) => pendingChange.status === "queued");
}

export function shouldAcceptAuthoritativeLiveConfig(
  current: SessionLiveConfigSnapshot | null | undefined,
  next: SessionLiveConfigSnapshot | null | undefined,
): boolean {
  if (!next) {
    return false;
  }

  if (!current) {
    return true;
  }

  return next.sourceSeq >= current.sourceSeq;
}
