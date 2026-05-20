import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function resolveActiveProjectedSessionForPendingWorkspace(
  workspaceId: string,
  pendingEntry: PendingWorkspaceEntry | null | undefined,
): string | null {
  const activeSessionId = useSessionSelectionStore.getState().activeSessionId;
  if (!activeSessionId || pendingEntry?.workspaceId !== workspaceId) {
    return null;
  }

  const activeSession = getSessionRecord(activeSessionId);
  if (!activeSession || activeSession.materializedSessionId) {
    return null;
  }

  return activeSession.workspaceId === buildPendingWorkspaceUiKey(pendingEntry)
    ? activeSessionId
    : null;
}
