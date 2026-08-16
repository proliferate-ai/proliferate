import {
  closeSessionStreamHandle,
  getSessionStreamHandle,
  type ManagedSessionStreamHandle,
} from "#product/lib/access/anyharness/session-stream-handles";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

export interface PaneStreamHandleClosureLease {
  materializedSessionId: string;
  handle: ManagedSessionStreamHandle;
}

export interface PaneStreamHandleClosureAttempt {
  mayOwnOpenedHandle: boolean;
  materializedSessionId: string | null;
  baselineHandle: ManagedSessionStreamHandle | null;
}

/**
 * Closes whichever pane-owned stream handles are still open for a released
 * session and marks the directory entry disconnected if any handle actually
 * closed. Extracted (pure side effect, no state of its own) from
 * releasePaneStream in use-agents-pane-session-lifecycle.ts to hold that
 * file's line ratchet; behavior is unchanged.
 */
export function closePaneStreamHandles(
  sessionId: string,
  lease: PaneStreamHandleClosureLease | null,
  attempt: PaneStreamHandleClosureAttempt | null,
): void {
  const handlesToClose = new Map<string, ManagedSessionStreamHandle>();
  if (lease) {
    handlesToClose.set(lease.materializedSessionId, lease.handle);
  }
  if (attempt?.mayOwnOpenedHandle && attempt.materializedSessionId) {
    const currentHandle = getSessionStreamHandle(attempt.materializedSessionId);
    if (currentHandle && currentHandle !== attempt.baselineHandle) {
      handlesToClose.set(attempt.materializedSessionId, currentHandle);
    }
  }

  let closed = false;
  for (const [materializedSessionId, handle] of handlesToClose) {
    closed = closeSessionStreamHandle(materializedSessionId, handle) || closed;
  }
  if (closed && getSessionRecord(sessionId)) {
    useSessionDirectoryStore.getState().patchEntry(sessionId, {
      streamConnectionState: "disconnected",
    });
  }
}
