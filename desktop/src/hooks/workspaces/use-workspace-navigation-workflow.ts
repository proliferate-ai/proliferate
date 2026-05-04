import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { markWorkspaceViewed } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useWorkspaceNavigationWorkflow() {
  const location = useLocation();
  const navigate = useNavigate();
  const setPendingWorkspaceEntry = useHarnessStore((state) => state.setPendingWorkspaceEntry);
  const deselectWorkspacePreservingSlots = useHarnessStore(
    (state) => state.deselectWorkspacePreservingSlots,
  );
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
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
      deselectWorkspacePreservingSlots();
      resetWorkspaceEditorState();
    } else if (pendingWorkspaceEntry) {
      setPendingWorkspaceEntry(null);
      resetWorkspaceEditorState();
    }
    navigate(path);
  }, [
    deselectWorkspacePreservingSlots,
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
