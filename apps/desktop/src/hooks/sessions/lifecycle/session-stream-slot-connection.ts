import { closeSessionStreamHandle } from "@/lib/access/anyharness/session-stream-handles";
import { clearSessionReconnectTimer } from "@/lib/workflows/sessions/session-reconnect-state";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  getMaterializedSessionId,
  getSessionRecord,
} from "@/stores/sessions/session-records";

export function closeSessionSlotStream(sessionId: string): void {
  clearSessionReconnectTimer(sessionId);
  const materializedSessionId = getMaterializedSessionId(sessionId);
  const closed = materializedSessionId
    ? closeSessionStreamHandle(materializedSessionId)
    : false;
  if (closed || getSessionRecord(sessionId)) {
    useSessionDirectoryStore.getState().patchEntry(sessionId, {
      streamConnectionState: "disconnected",
    });
  }
}
