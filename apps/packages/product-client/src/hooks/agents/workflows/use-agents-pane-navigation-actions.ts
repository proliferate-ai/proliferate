import { useCallback } from "react";
import { useWorkspaceShellActions } from "#product/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { useAgentsPaneNavigationStore } from "#product/stores/agents/agents-pane-navigation-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export interface AgentsPaneNavigationTarget {
  workspaceId: string;
  parentSessionId: string;
  childSessionId?: string | null;
}

/**
 * Opens a durable subagent route inside the Agents tool without selecting a
 * chat tab. Callers must already have authoritative current-workspace
 * subagent provenance; ordinary/promoted/cowork/review targets keep their
 * existing session-navigation paths.
 */
export function useAgentsPaneNavigationActions() {
  const shellActions = useWorkspaceShellActions();
  const selectedWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedWorkspaceId,
  );
  const openClusterRoute = useAgentsPaneNavigationStore((state) => state.openCluster);
  const openDetailRoute = useAgentsPaneNavigationStore((state) => state.openDetail);

  const openAgentsPaneTarget = useCallback((target: AgentsPaneNavigationTarget) => {
    if (target.workspaceId !== selectedWorkspaceId || !shellActions) {
      return false;
    }
    if (target.childSessionId) {
      openDetailRoute(
        target.workspaceId,
        target.parentSessionId,
        target.childSessionId,
      );
    } else {
      openClusterRoute(target.workspaceId, target.parentSessionId);
    }
    shellActions.openRightPanelTool("agents");
    return true;
  }, [openClusterRoute, openDetailRoute, selectedWorkspaceId, shellActions]);

  return { openAgentsPaneTarget };
}
