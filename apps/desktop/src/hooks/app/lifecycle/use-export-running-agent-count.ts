import { useEffect } from "react";
import { isSessionSlotBusy } from "@proliferate/product-domain/sessions/activity";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

type SessionEntries = ReturnType<typeof useSessionDirectoryStore.getState>["entriesById"];

function countBusy(entries: SessionEntries): number {
  return Object.values(entries).filter((entry) =>
    isSessionSlotBusy(activitySnapshotFromDirectoryEntry(entry))
  ).length;
}

// Owns exporting the current busy-agent count to the native window layer via
// the supplied export function (host.desktop.nativeUi.setRunningAgentCount).
// It does not own session activity rules or native window primitives.
export function useExportRunningAgentCount(
  setRunningAgentCount: (count: number) => Promise<void>,
): void {
  useEffect(() => {
    let lastCount = countBusy(useSessionDirectoryStore.getState().entriesById);
    void setRunningAgentCount(lastCount);

    const unsubscribe = useSessionDirectoryStore.subscribe((state) => {
      const next = countBusy(state.entriesById);
      if (next !== lastCount) {
        lastCount = next;
        void setRunningAgentCount(next);
      }
    });

    return unsubscribe;
  }, [setRunningAgentCount]);
}
