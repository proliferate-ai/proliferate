import { useCallback } from "react";
import { webWorkspaceDeepLink } from "@proliferate/cloud-sdk";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { navigateApp } from "#product/lib/workflows/app/app-navigate-handoff";
import { useWebAppTarget } from "#product/hooks/capabilities/derived/use-web-app-target";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";
import { logicalWorkspaceMatchesId } from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";
import { resetWorkspaceEditorState } from "#product/stores/editor/workspace-editor-state";
import { markWorkspaceViewed } from "#product/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useAttendedPendingWorkspaceEntry } from "#product/hooks/workspaces/derived/use-pending-workspace-entries";
import { useToastStore } from "#product/stores/toast/toast-store";

// Navigation-only workflow: every consumer calls these inside event handlers,
// so it reads the URL at call time and navigates through the `navigateApp`
// handoff instead of `useLocation`/`useNavigate` — in declarative-router mode
// those subscribe their caller (the sidebar, the lifecycle root, command
// surfaces) to every location change, re-rendering them on each page switch
// and Settings section click (PRO-170, PRO-182).
export function useWorkspaceNavigationWorkflow() {
  const deselectWorkspacePreservingSessions = useSessionSelectionStore(
    (state) => state.deselectWorkspacePreservingSessions,
  );
  const pendingWorkspaceEntry = useAttendedPendingWorkspaceEntry();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { selectWorkspace } = useWorkspaceSelection();
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const { openExternal } = useProductHost().links;
  const webApp = useWebAppTarget();
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);

  const navigateToWorkspaceShell = useCallback(() => {
    if (window.location.pathname !== "/") {
      navigateApp("/");
    }
  }, []);

  const goToTopLevelRoute = useCallback((path: string) => {
    if (selectedWorkspaceId || selectedLogicalWorkspaceId || pendingWorkspaceEntry) {
      deselectWorkspacePreservingSessions();
      resetWorkspaceEditorState();
    }
    navigateApp(path);
  }, [
    deselectWorkspacePreservingSessions,
    pendingWorkspaceEntry,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
  ]);

  const selectWorkspaceFromSurface = useCallback(function selectWorkspaceFromSurface(
    workspaceId: string,
    source: string,
  ) {
    const unclaimedCloudWorkspace = logicalWorkspaces.find((workspace) =>
      logicalWorkspaceMatchesId(workspace, workspaceId) &&
      workspace.cloudWorkspace?.visibility === "shared_unclaimed"
    )?.cloudWorkspace;
    // Unclaimed shared-cloud workspaces are claimed from the web app. Only hand
    // off to web when this deployment actually has one; otherwise fall through
    // to normal in-desktop selection rather than opening a dead vendor link.
    if (unclaimedCloudWorkspace && webApp.available && webApp.baseUrl) {
      const url = webWorkspaceDeepLink(
        unclaimedCloudWorkspace.id,
        webApp.baseUrl,
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
      showErrorToast({
        headline: "Workspace not opened",
        consequence: "You are still in the workspace you were in.",
        cause: error instanceof Error ? error.message : String(error),
        retry: () => selectWorkspaceFromSurface(workspaceId, source),
      });
    });
  }, [
    logicalWorkspaces,
    navigateToWorkspaceShell,
    openExternal,
    selectedLogicalWorkspaceId,
    selectWorkspace,
    showErrorToast,
    showToast,
    webApp.available,
    webApp.baseUrl,
  ]);

  return {
    goToTopLevelRoute,
    navigateToWorkspaceShell,
    selectWorkspaceFromSurface,
  };
}
