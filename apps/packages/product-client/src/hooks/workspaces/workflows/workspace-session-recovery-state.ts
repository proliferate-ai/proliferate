import { markWorkspaceBootstrappedInSession } from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import type {
  WorkspaceSessionRecoveryReason,
} from "#product/lib/domain/workspaces/selection/session-recovery";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function enterWorkspaceSessionRecovery(
  workspaceId: string,
  logicalWorkspaceId: string,
  reason: WorkspaceSessionRecoveryReason,
  sessionId = useSessionSelectionStore.getState().activeSessionId,
): boolean {
  markWorkspaceBootstrappedInSession(workspaceId);
  if (!sessionId) {
    return false;
  }
  useSessionSelectionStore.getState().setWorkspaceSessionRecovery({
    workspaceId,
    logicalWorkspaceId,
    sessionId,
    reason,
  });
  return true;
}
