import { batchSessionStoreWrites } from "@/lib/infra/scheduling/react-batching";
import {
  patchSessionRecord,
  removeSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";

export function materializeSessionRecord(
  clientSessionId: string,
  materializedSessionId: string,
  record: SessionRuntimeRecord,
): void {
  batchSessionStoreWrites(() => {
    patchSessionRecord(clientSessionId, {
      ...record,
      sessionId: clientSessionId,
      materializedSessionId,
    });
  });
}

export function removeSessionRecordAndClearSelection(sessionId: string): void {
  batchSessionStoreWrites(() => {
    removeSessionRecord(sessionId);
    const selection = useSessionSelectionStore.getState();
    if (selection.activeSessionId === sessionId) {
      selection.setActiveSessionId(null);
    }
  });
}
