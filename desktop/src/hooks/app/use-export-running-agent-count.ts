import { useEffect } from "react";
import { isSessionSlotBusy } from "@/lib/domain/sessions/activity";
import { useTauriWindowActions } from "@/hooks/access/tauri/use-window-actions";
import {
  activitySnapshotFromDirectoryEntry,
  useSessionDirectoryStore,
} from "@/stores/sessions/session-directory-store";

type SessionEntries = ReturnType<typeof useSessionDirectoryStore.getState>["entriesById"];

function countBusy(entries: SessionEntries): number {
  return Object.values(entries).filter((entry) =>
    isSessionSlotBusy(activitySnapshotFromDirectoryEntry(entry))
  ).length;
}

export function useExportRunningAgentCount(): void {
  const { setRunningAgentCount } = useTauriWindowActions();

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
