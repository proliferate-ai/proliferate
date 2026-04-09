import { useEffect } from "react";
import { isSessionSlotBusy } from "@/lib/domain/sessions/activity";
import { setRunningAgentCount } from "@/platform/tauri/window";
import { useHarnessStore } from "@/stores/sessions/harness-store";

type SessionSlots = ReturnType<typeof useHarnessStore.getState>["sessionSlots"];

function countBusy(slots: SessionSlots): number {
  return Object.values(slots).filter((slot) => isSessionSlotBusy(slot)).length;
}

export function useExportRunningAgentCount(): void {
  useEffect(() => {
    let lastCount = countBusy(useHarnessStore.getState().sessionSlots);
    void setRunningAgentCount(lastCount);

    const unsubscribe = useHarnessStore.subscribe((state) => {
      const next = countBusy(state.sessionSlots);
      if (next !== lastCount) {
        lastCount = next;
        void setRunningAgentCount(next);
      }
    });

    return unsubscribe;
  }, []);
}
