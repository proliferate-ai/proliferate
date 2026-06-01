import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  isOptimisticWorkspaceSessionPlaceholder,
} from "@/lib/domain/workspaces/selection/optimistic-session-shell";
import { writeChatShellIntentForEmptySurface } from "@/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import {
  getSessionRecord,
  removeSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function findLoadedSessionForClientSession(
  clientSessionId: string,
  sessions: readonly WorkspaceSession[],
): WorkspaceSession | null {
  const record = getSessionRecord(clientSessionId);
  const materializedSessionId = record?.materializedSessionId ?? clientSessionId;
  return sessions.find((session) =>
    session.id === materializedSessionId || session.id === clientSessionId
  ) ?? null;
}

export function clearInvalidOptimisticActiveSession(input: {
  workspaceId: string;
  logicalWorkspaceId: string;
}): boolean {
  const activeSessionId = useSessionSelectionStore.getState().activeSessionId;
  const activeSession = activeSessionId ? getSessionRecord(activeSessionId) : null;
  if (
    !activeSessionId
    || activeSession?.workspaceId !== input.workspaceId
    || !isOptimisticWorkspaceSessionPlaceholder(activeSession)
  ) {
    return false;
  }

  removeSessionRecord(activeSessionId);
  useSessionSelectionStore.getState().setActiveSessionId(null);
  writeChatShellIntentForEmptySurface({
    workspaceId: input.workspaceId,
    shellWorkspaceId: input.logicalWorkspaceId,
    invalidateSessionIntent: false,
  });
  logLatency("workspace.select.optimistic_session_invalidated", {
    workspaceId: input.workspaceId,
    logicalWorkspaceId: input.logicalWorkspaceId,
    sessionId: activeSessionId,
  });
  return true;
}
