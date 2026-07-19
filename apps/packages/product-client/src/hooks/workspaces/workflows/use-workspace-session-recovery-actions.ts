import { useCallback, useState } from "react";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { enterWorkspaceSessionRecovery } from "#product/hooks/workspaces/workflows/workspace-session-recovery-state";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function useWorkspaceSessionRecoveryActions() {
  const [isRetrying, setIsRetrying] = useState(false);
  const recovery = useSessionSelectionStore((state) => state.workspaceSessionRecovery);
  const { selectWorkspace } = useWorkspaceSelection();

  const retry = useCallback(async () => {
    if (!recovery || isRetrying) {
      return;
    }
    setIsRetrying(true);
    try {
      await selectWorkspace(recovery.logicalWorkspaceId, {
        force: true,
        forceCold: true,
        forceSessionDirectoryRefresh: true,
        initialActiveSessionId: recovery.sessionId,
      });
    } catch {
      enterWorkspaceSessionRecovery(
        recovery.workspaceId,
        recovery.logicalWorkspaceId,
        "session-selection-failed",
        recovery.sessionId,
      );
    } finally {
      setIsRetrying(false);
    }
  }, [isRetrying, recovery, selectWorkspace]);

  return {
    isRetrying,
    recovery,
    retry,
  };
}
