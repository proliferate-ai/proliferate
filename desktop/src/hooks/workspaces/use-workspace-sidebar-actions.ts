import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { WorkspaceRetireResponse } from "@anyharness/sdk";
import { useToastStore } from "@/stores/toast/toast-store";
import { APP_ROUTES } from "@/config/app-routes";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { useCreateCloudWorkspace } from "@/hooks/cloud/use-create-cloud-workspace";
import type { CloudWorkspaceRepoTarget } from "@/lib/domain/workspaces/cloud-workspace-creation";
import type { SidebarIndicatorAction } from "@/lib/domain/workspaces/sidebar";
import { useWorkspaceEntryActions } from "./use-workspace-entry-actions";
import { useWorkspaceSelection } from "./selection/use-workspace-selection";
import { useWorkspaceActivationWorkflow } from "./use-workspace-activation-workflow";
import { useAddRepo } from "./use-add-repo";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { markWorkspaceViewed } from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceRetireActions } from "./use-workspace-retire-actions";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useWorkspaceSidebarActions() {
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
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const {
    createLocalWorkspaceAndEnter,
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
  } = useWorkspaceEntryActions();
  const {
    createCloudWorkspaceAndEnter,
    isCreatingCloudWorkspace,
  } = useCreateCloudWorkspace();
  const { addRepoFromPicker } = useAddRepo();
  const showToast = useToastStore((state) => state.show);
  const { markDone, retryCleanup } = useWorkspaceRetireActions();
  const dismissFinishSuggestion = useWorkspaceUiStore((state) => state.dismissFinishSuggestion);

  const handleAddRepo = useCallback(() => {
    void addRepoFromPicker();
  }, [addRepoFromPicker]);

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
      useWorkspaceFilesStore.getState().reset();
    } else if (pendingWorkspaceEntry) {
      setPendingWorkspaceEntry(null);
      useWorkspaceFilesStore.getState().reset();
    }
    navigate(path);
  }, [
    deselectWorkspacePreservingSlots,
    mobility.selectionLocked,
    navigate,
    pendingWorkspaceEntry,
    setPendingWorkspaceEntry,
    selectedWorkspaceId,
    showToast,
  ]);

  const handleGoHome = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.home);
  }, [goToTopLevelRoute]);

  const handleGoPlugins = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.plugins);
  }, [goToTopLevelRoute]);

  const handleGoAutomations = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.automations);
  }, [goToTopLevelRoute]);

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
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
      source: "sidebar",
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

  const handleSidebarIndicatorAction = useCallback((action: SidebarIndicatorAction) => {
    switch (action.kind) {
      case "open_workspace":
        handleSelectWorkspace(action.workspaceId);
        return;
      case "open_automations":
        goToTopLevelRoute(action.automationId
          ? `/automations/${encodeURIComponent(action.automationId)}`
          : "/automations");
        return;
      case "open_source_session": {
        if (mobility.selectionLocked && action.workspaceId !== mobility.selectedLogicalWorkspaceId) {
          showToast("Finish the current workspace move before switching workspaces.");
          return;
        }

        navigateToWorkspaceShell();
        void openWorkspaceSession({
          workspaceId: action.workspaceId,
          sessionId: action.sessionId,
          forceWorkspaceSelection: true,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          showToast(`Failed to open source session: ${message}`);
        });
        return;
      }
      case "mark_workspace_done":
        void markDone(action.workspaceId, {
          logicalWorkspaceId: action.logicalWorkspaceId ?? null,
        }).then((result) => {
          if (result.outcome === "blocked") {
            showToast(workspaceRetireBlockedMessage(result));
          } else if (result.outcome === "cleanup_failed") {
            showToast("Workspace marked done, but cleanup needs attention.");
          }
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          showToast(`Failed to mark done: ${message}`);
        });
        return;
      case "keep_workspace_active":
        dismissFinishSuggestion(action.workspaceId, action.readinessFingerprint);
        return;
    }
  }, [
    dismissFinishSuggestion,
    goToTopLevelRoute,
    handleSelectWorkspace,
    markDone,
    mobility.selectedLogicalWorkspaceId,
    mobility.selectionLocked,
    navigateToWorkspaceShell,
    openWorkspaceSession,
    selectWorkspace,
    showToast,
  ]);

  const handleMarkWorkspaceDone = useCallback((workspaceId: string, logicalWorkspaceId: string) => {
    void markDone(workspaceId, { logicalWorkspaceId }).then((result) => {
      if (result.outcome === "blocked") {
        showToast(workspaceRetireBlockedMessage(result));
      } else if (result.outcome === "cleanup_failed") {
        showToast("Workspace marked done, but cleanup needs attention.");
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to mark done: ${message}`);
    });
  }, [markDone, showToast]);

  const handleRetryWorkspaceCleanup = useCallback((workspaceId: string) => {
    void retryCleanup(workspaceId).then((result) => {
      if (result.outcome === "blocked") {
        showToast(workspaceRetireBlockedMessage(result));
      } else if (result.outcome === "cleanup_failed") {
        showToast("Cleanup still needs attention.");
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to retry cleanup: ${message}`);
    });
  }, [retryCleanup, showToast]);

  const handleCreateLocalWorkspace = useCallback((
    sourceRoot: string | null,
    repoGroupKeyToExpand?: string | null,
  ) => {
    if (!sourceRoot) {
      return;
    }

    navigateToWorkspaceShell();
    // Use lightweight path when already in a workspace (sidebar creation)
    // to avoid disrupting the current workspace with a pending shell.
    const lightweight = !!selectedWorkspaceId;
    void createLocalWorkspaceAndEnter(sourceRoot, {
      lightweight,
      repoGroupKeyToExpand: repoGroupKeyToExpand ?? sourceRoot,
    }).catch((error) => {
      if (lightweight) {
        const message = error instanceof Error ? error.message : "Failed to create workspace.";
        showToast(message);
      }
    });
  }, [createLocalWorkspaceAndEnter, navigateToWorkspaceShell, selectedWorkspaceId, showToast]);

  const handleCreateWorktreeWorkspace = useCallback((
    repoRootId: string | null,
    repoGroupKeyToExpand?: string | null,
  ) => {
    if (!repoRootId || isCreatingWorktreeWorkspace) {
      return;
    }

    navigateToWorkspaceShell();
    // Use lightweight path when already in a workspace (sidebar creation)
    // to avoid disrupting the current workspace with a pending shell.
    const lightweight = !!selectedWorkspaceId;
    const latencyFlowId = startLatencyFlow({
      flowKind: "worktree_enter",
      source: "sidebar",
      targetWorkspaceId: repoRootId,
    });
    void createWorktreeAndEnter({ repoRootId }, {
      lightweight,
      latencyFlowId,
      repoGroupKeyToExpand,
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "worktree_enter_failed");
      if (lightweight) {
        const message = error instanceof Error ? error.message : "Failed to create worktree.";
        showToast(message);
      }
    });
  }, [
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
    navigateToWorkspaceShell,
    selectedWorkspaceId,
    showToast,
  ]);

  const handleCreateCloudWorkspace = useCallback((
    target: CloudWorkspaceRepoTarget | null,
    repoGroupKeyToExpand?: string | null,
  ) => {
    if (!target || isCreatingCloudWorkspace) {
      return;
    }

    navigateToWorkspaceShell();
    const latencyFlowId = startLatencyFlow({
      flowKind: "cloud_workspace_create",
      source: "sidebar",
    });
    void createCloudWorkspaceAndEnter(target, { latencyFlowId, repoGroupKeyToExpand });
  }, [
    createCloudWorkspaceAndEnter,
    isCreatingCloudWorkspace,
    navigateToWorkspaceShell,
  ]);

  return {
    handleAddRepo,
    handleGoHome,
    handleGoPlugins,
    handleGoAutomations,
    handleSidebarIndicatorAction,
    handleMarkWorkspaceDone,
    handleRetryWorkspaceCleanup,
    handleSelectWorkspace,
    handleCreateLocalWorkspace,
    handleCreateWorktreeWorkspace,
    handleCreateCloudWorkspace,
  };
}

function workspaceRetireBlockedMessage(result: WorkspaceRetireResponse): string {
  const blocker = result.preflight.blockers[0];
  if (blocker) {
    const extraCount = result.preflight.blockers.length - 1;
    return extraCount > 0
      ? `${blocker.message} (+${extraCount} more)`
      : blocker.message;
  }

  return result.cleanupMessage?.trim() || "Workspace is not ready to mark done.";
}
