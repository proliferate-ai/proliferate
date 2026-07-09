import { useCallback } from "react";
import type { WorkspacePurgeResponse, WorkspaceRetireResponse } from "@anyharness/sdk";
import { useToastStore } from "@/stores/toast/toast-store";
import { APP_ROUTES } from "@/config/app-routes";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useCreateCloudWorkspace } from "@/hooks/cloud/workflows/use-create-cloud-workspace";
import type { CloudWorkspaceRepoTarget } from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import type { SidebarIndicatorAction } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import { useAddRepoFlowStore } from "@/stores/ui/add-repo-flow-store";
import { useWorkspaceActivationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/workflows/use-workspace-entry-actions";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { useWorkspaceRetireActions } from "@/hooks/workspaces/workflows/use-workspace-retire-actions";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";

export function useWorkspaceSidebarActions() {
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const {
    goToTopLevelRoute,
    navigateToWorkspaceShell,
    selectWorkspaceFromSurface,
  } = useWorkspaceNavigationWorkflow();
  const {
    createLocalWorkspaceAndEnter,
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
  } = useWorkspaceEntryActions();
  const {
    createCloudWorkspaceAndEnter,
    isCreatingCloudWorkspace,
  } = useCreateCloudWorkspace();
  const openAddRepoFlow = useAddRepoFlowStore((state) => state.openFlow);
  const showToast = useToastStore((state) => state.show);
  const { markDone, retryCleanup } = useWorkspaceRetireActions();
  const { openExternal } = useTauriShellActions();

  const handleAddRepo = useCallback(() => {
    openAddRepoFlow();
  }, [openAddRepoFlow]);

  const handleGoHome = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.home);
  }, [goToTopLevelRoute]);

  const handleGoWorkflows = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.workflows);
  }, [goToTopLevelRoute]);

  const handleGoWorkspaces = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.workspaces);
  }, [goToTopLevelRoute]);

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    selectWorkspaceFromSurface(workspaceId, "sidebar");
  }, [selectWorkspaceFromSurface]);

  const handleOpenPullRequest = useCallback((url: string) => {
    void openExternal(url).catch(() => {
      showToast("Failed to open the pull request.");
    });
  }, [openExternal, showToast]);

  const handleSidebarIndicatorAction = useCallback((action: SidebarIndicatorAction) => {
    switch (action.kind) {
      case "open_workspace":
        handleSelectWorkspace(action.workspaceId);
        return;
      case "open_automations":
        goToTopLevelRoute(action.automationId
          ? `/workflows/${encodeURIComponent(action.automationId)}`
          : "/workflows");
        return;
      case "open_source_session": {
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
    }
  }, [
    goToTopLevelRoute,
    handleSelectWorkspace,
    navigateToWorkspaceShell,
    openWorkspaceSession,
    showToast,
  ]);

  const handleMarkWorkspaceDone = useCallback((workspaceId: string, logicalWorkspaceId: string) => {
    void markDone(workspaceId, { logicalWorkspaceId }).then((result) => {
      if (result.outcome === "blocked") {
        showToast(workspaceRetireBlockedMessage(result));
      } else if (result.outcome === "cleanup_failed") {
        showToast("Workspace delete started, but cleanup needs attention.");
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to delete workspace: ${message}`);
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
    void createLocalWorkspaceAndEnter(sourceRoot, {
      repoGroupKeyToExpand: repoGroupKeyToExpand ?? sourceRoot,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to create workspace.";
      showToast(message);
    });
  }, [createLocalWorkspaceAndEnter, navigateToWorkspaceShell, showToast]);

  const handleCreateWorktreeWorkspace = useCallback((
    repoRootId: string | null,
    repoGroupKeyToExpand?: string | null,
  ) => {
    if (!repoRootId || isCreatingWorktreeWorkspace) {
      return;
    }

    navigateToWorkspaceShell();
    const latencyFlowId = startLatencyFlow({
      flowKind: "worktree_enter",
      source: "sidebar",
      targetWorkspaceId: repoRootId,
    });
    void createWorktreeAndEnter({ repoRootId }, {
      latencyFlowId,
      repoGroupKeyToExpand,
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "worktree_enter_failed");
      const message = error instanceof Error ? error.message : "Failed to create worktree.";
      showToast(message);
    });
  }, [
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
    navigateToWorkspaceShell,
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
    handleGoWorkflows,
    handleGoWorkspaces,
    handleSidebarIndicatorAction,
    handleOpenPullRequest,
    handleMarkWorkspaceDone,
    handleRetryWorkspaceCleanup,
    handleSelectWorkspace,
    handleCreateLocalWorkspace,
    handleCreateWorktreeWorkspace,
    handleCreateCloudWorkspace,
  };
}

function workspaceRetireBlockedMessage(result: WorkspaceRetireResponse | WorkspacePurgeResponse): string {
  const blocker = result.preflight?.blockers[0];
  if (blocker) {
    const extraCount = (result.preflight?.blockers.length ?? 0) - 1;
    return extraCount > 0
      ? `${blocker.message} (+${extraCount} more)`
      : blocker.message;
  }

  return result.cleanupMessage?.trim() || "Workspace is not ready to delete.";
}
