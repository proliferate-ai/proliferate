import { useCallback } from "react";
import type { Workspace } from "@anyharness/sdk";
import { navigateApp } from "#product/lib/workflows/app/app-navigate-handoff";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
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
    // A workspace a surface just had created for it (a workflow launch) is not
    // in the collections cache yet; pass the record so selection resolves it
    // directly instead of hard-failing "Workspace not found."
    options?: { knownWorkspace?: Workspace | null },
  ) {
    // Unclaimed shared-cloud workspaces used to hand off to the web app; the
    // cloud workspace stack is deleted, so every selection stays in-desktop.
    navigateToWorkspaceShell();
    if (workspaceId === selectedLogicalWorkspaceId) {
      markWorkspaceViewed(workspaceId);
    }
    const latencyFlowId = startLatencyFlow({
      flowKind: "workspace_switch",
      source,
      targetWorkspaceId: workspaceId,
    });
    void selectWorkspace(workspaceId, {
      latencyFlowId,
      knownWorkspace: options?.knownWorkspace ?? null,
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "workspace_switch_failed");
      showErrorToast({
        headline: "Workspace not opened",
        consequence: "You are still in the workspace you were in.",
        cause: error instanceof Error ? error.message : String(error),
        retry: () => selectWorkspaceFromSurface(workspaceId, source, options),
      });
    });
  }, [
    navigateToWorkspaceShell,
    selectedLogicalWorkspaceId,
    selectWorkspace,
    showErrorToast,
  ]);

  return {
    goToTopLevelRoute,
    navigateToWorkspaceShell,
    selectWorkspaceFromSurface,
  };
}
