import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { markWorkspaceViewed } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useWorkspaceNavigationWorkflow() {
  const location = useLocation();
  const navigate = useNavigate();
  const setPendingWorkspaceEntry = useSessionSelectionStore((state) => state.setPendingWorkspaceEntry);
  const deselectWorkspacePreservingSessions = useSessionSelectionStore(
    (state) => state.deselectWorkspacePreservingSessions,
  );
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const mobility = useWorkspaceMobilityState();
  const { selectWorkspace } = useWorkspaceSelection();
  const showToast = useToastStore((state) => state.show);

  const navigateToWorkspaceShell = useCallback(() => {
    if (location.pathname !== "/") {
      navigate("/");
    }
  }, [location.pathname, navigate]);

  const goToTopLevelRoute = useCallback((path: string) => {
    if (mobility.selectionLocked) {
      showToast("Finish the current workspace move before leaving this workspace.");
      return;
    }

    if (selectedWorkspaceId) {
      deselectWorkspacePreservingSessions();
      resetWorkspaceEditorState();
    } else if (pendingWorkspaceEntry) {
      setPendingWorkspaceEntry(null);
      resetWorkspaceEditorState();
    }
    navigate(path);
  }, [
    deselectWorkspacePreservingSessions,
    mobility.selectionLocked,
    navigate,
    pendingWorkspaceEntry,
    selectedWorkspaceId,
    setPendingWorkspaceEntry,
    showToast,
  ]);

  const selectWorkspaceFromSurface = useCallback((workspaceId: string, source: string) => {
    if (mobility.selectionLocked && workspaceId !== mobility.selectedLogicalWorkspaceId) {
      showToast("Finish the current workspace move before switching workspaces.");
      return;
    }

    navigateToWorkspaceShell();
    if (workspaceId === mobility.selectedLogicalWorkspaceId) {
      markWorkspaceViewed(workspaceId);
    }
    const latencyFlowId = startLatencyFlow({
      flowKind: "workspace_switch",
      source,
      targetWorkspaceId: workspaceId,
    });
    void selectWorkspace(workspaceId, { latencyFlowId }).catch((error) => {
      failLatencyFlow(latencyFlowId, "workspace_switch_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to select workspace: ${message}`);
    });
  }, [
    mobility.selectedLogicalWorkspaceId,
    mobility.selectionLocked,
    navigateToWorkspaceShell,
    selectWorkspace,
    showToast,
  ]);

  return {
    goToTopLevelRoute,
    navigateToWorkspaceShell,
    selectWorkspaceFromSurface,
  };
}
