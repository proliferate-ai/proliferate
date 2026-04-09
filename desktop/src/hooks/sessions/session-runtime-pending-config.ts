import {
  collectFailedQueuedChangesMatchingMutationIds,
  hasQueuedPendingConfigChanges,
  snapshotQueuedPendingConfigMutationIds,
  type PendingSessionConfigChanges,
} from "@/lib/domain/sessions/pending-config";
import { useHarnessStore } from "@/stores/sessions/harness-store";

const pendingConfigRollbackTimers = new Map<string, number>();

function withoutPendingConfigChanges(
  pendingConfigChanges: PendingSessionConfigChanges,
  rawConfigIds: string[],
): PendingSessionConfigChanges {
  if (rawConfigIds.length === 0) {
    return pendingConfigChanges;
  }

  const nextPendingConfigChanges = { ...pendingConfigChanges };
  for (const rawConfigId of rawConfigIds) {
    delete nextPendingConfigChanges[rawConfigId];
  }

  return nextPendingConfigChanges;
}

export function clearPendingConfigRollbackCheck(sessionId: string): void {
  const timer = pendingConfigRollbackTimers.get(sessionId);
  if (timer === undefined) {
    return;
  }

  window.clearTimeout(timer);
  pendingConfigRollbackTimers.delete(sessionId);
}

export function schedulePendingConfigRollbackCheck(
  sessionId: string,
  refreshSessionSlotMeta: (
    sessionId: string,
    options?: { resumeIfActive?: boolean; requestHeaders?: HeadersInit },
  ) => Promise<void>,
  showToast: (message: string, type?: "error" | "info") => void,
): void {
  const slot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
  if (!slot || !hasQueuedPendingConfigChanges(slot.pendingConfigChanges)) {
    clearPendingConfigRollbackCheck(sessionId);
    return;
  }

  const queuedMutationIds = snapshotQueuedPendingConfigMutationIds(slot.pendingConfigChanges);
  clearPendingConfigRollbackCheck(sessionId);
  pendingConfigRollbackTimers.set(sessionId, window.setTimeout(() => {
    pendingConfigRollbackTimers.delete(sessionId);

    void refreshSessionSlotMeta(sessionId, { resumeIfActive: false })
      .finally(() => {
        const latestSlot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
        if (!latestSlot) {
          return;
        }

        const failedQueuedChanges = collectFailedQueuedChangesMatchingMutationIds(
          latestSlot.liveConfig,
          latestSlot.pendingConfigChanges,
          queuedMutationIds,
        );
        if (failedQueuedChanges.length === 0) {
          return;
        }

        useHarnessStore.getState().patchSessionSlot(sessionId, {
          pendingConfigChanges: withoutPendingConfigChanges(
            latestSlot.pendingConfigChanges,
            failedQueuedChanges.map((change) => change.rawConfigId),
          ),
        });
        showToast("Queued config change didn’t apply. Restored actual session config.");
      });
  }, 250));
}
