import { closeSessionStreamHandle } from "#product/lib/access/anyharness/session-stream-handles";
import { clearSessionReconnectTimer } from "#product/lib/workflows/sessions/session-reconnect-state";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  getMaterializedSessionId,
  getSessionRecord,
} from "#product/stores/sessions/session-records";

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
