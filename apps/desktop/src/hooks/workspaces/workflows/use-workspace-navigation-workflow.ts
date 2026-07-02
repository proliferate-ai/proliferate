import { useCallback } from "react";
import { webWorkspaceDeepLink } from "@proliferate/cloud-sdk";
import { useLocation, useNavigate } from "react-router-dom";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { logicalWorkspaceMatchesId } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { markWorkspaceViewed } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useWorkspaceNavigationWorkflow() {
  const location = useLocation();
  const navigate = useNavigate();
  const deselectWorkspacePreservingSessions = useSessionSelectionStore(
    (state) => state.deselectWorkspacePreservingSessions,
  );
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { selectWorkspace } = useWorkspaceSelection();
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const { openExternal } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);

  const navigateToWorkspaceShell = useCallback(() => {
    if (location.pathname !== "/") {
      navigate("/");
    }
  }, [location.pathname, navigate]);

  const goToTopLevelRoute = useCallback((path: string) => {
    if (selectedWorkspaceId || selectedLogicalWorkspaceId || pendingWorkspaceEntry) {
      deselectWorkspacePreservingSessions();
      resetWorkspaceEditorState();
    }
    navigate(path);
  }, [
    deselectWorkspacePreservingSessions,
    navigate,
    pendingWorkspaceEntry,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  ]);

  const selectWorkspaceFromSurface = useCallback((workspaceId: string, source: string) => {
    const unclaimedCloudWorkspace = logicalWorkspaces.find((workspace) =>
      logicalWorkspaceMatchesId(workspace, workspaceId) &&
      workspace.cloudWorkspace?.visibility === "shared_unclaimed"
    )?.cloudWorkspace;
    if (unclaimedCloudWorkspace) {
      const url = webWorkspaceDeepLink(
        unclaimedCloudWorkspace.id,
        getProliferateWebBaseUrl(),
      );
      void openExternal(url).catch(() => {
        showToast("Failed to open the web workspace.");
      });
      return;
    }

    navigateToWorkspaceShell();
    if (workspaceId === selectedLogicalWorkspaceId) {
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
    logicalWorkspaces,
    navigateToWorkspaceShell,
    openExternal,
    selectedLogicalWorkspaceId,
    selectWorkspace,
    showToast,
  ]);

  return {
    goToTopLevelRoute,
    navigateToWorkspaceShell,
    selectWorkspaceFromSurface,
  };
}
