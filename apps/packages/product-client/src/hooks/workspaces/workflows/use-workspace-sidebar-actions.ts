import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useToastStore } from "#product/stores/toast/toast-store";
import { APP_ROUTES } from "#product/config/app-routes";
import { useCreateCloudWorkspace } from "#product/hooks/cloud/workflows/use-create-cloud-workspace";
import type { CloudWorkspaceRepoTarget } from "#product/lib/domain/workspaces/cloud/cloud-workspace-creation";
import type { SidebarIndicatorAction } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import { useAddRepoFlowStore } from "#product/stores/ui/add-repo-flow-store";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-workspace-entry-actions";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";
import { useWorkspacePurgeActions } from "#product/hooks/workspaces/workflows/use-workspace-purge-actions";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { useHomeNextTargetSelectionState } from "#product/hooks/home/ui/use-home-next-target-selection-state";
import { focusChatInput } from "#product/lib/domain/focus-zone";

export function useWorkspaceSidebarActions() {
  const { patchTargetSelection } = useHomeNextTargetSelectionState();
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
  const showErrorToast = useToastStore((state) => state.showError);
  const { markDone } = useWorkspacePurgeActions();
  const { openExternal } = useProductHost().links;

  const focusNewChatComposer = useCallback(() => {
    window.setTimeout(() => {
      focusChatInput();
    }, 0);
  }, []);

  const handleAddRepo = useCallback(() => {
    openAddRepoFlow();
  }, [openAddRepoFlow]);

  const handleGoHome = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.home);
    focusNewChatComposer();
  }, [focusNewChatComposer, goToTopLevelRoute]);

  const handleGoHomeForRepository = useCallback((sourceRoot: string) => {
    patchTargetSelection({
      destination: "repository",
      repositorySelection: { kind: "repository", sourceRoot },
      baseBranchOverride: null,
    });
    goToTopLevelRoute(APP_ROUTES.home);
    focusNewChatComposer();
  }, [focusNewChatComposer, goToTopLevelRoute, patchTargetSelection]);

  const handleStartWorktreeWorkspaceCreation = useCallback(() => {
    patchTargetSelection({
      destination: "repository",
      repoLaunchKind: "worktree",
    });
    goToTopLevelRoute(APP_ROUTES.home);
    focusNewChatComposer();
  }, [focusNewChatComposer, goToTopLevelRoute, patchTargetSelection]);

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

  const handleSidebarIndicatorAction = useCallback(function handleSidebarIndicatorAction(
    action: SidebarIndicatorAction,
  ) {
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
          showErrorToast({
            headline: "Session not opened",
            consequence: "You are still where you were; nothing was closed.",
            cause: errorMessage(error),
            retry: () => handleSidebarIndicatorAction(action),
          });
        });
        return;
      }
    }
  }, [
    goToTopLevelRoute,
    handleSelectWorkspace,
    navigateToWorkspaceShell,
    openWorkspaceSession,
    showErrorToast,
  ]);

  // Deleting a workspace now has exactly two outcomes on the wire:
  // `{ outcome: "deleted", alreadyDeleted }` or a thrown ProblemDetails. The
  // retire-era `blocked` / `cleanup_failed` results are gone with the
  // preflight and the tombstone, so every failure arrives through the catch
  // path — there is no success-shaped failure left to branch on.
  const handleMarkWorkspaceDone = useCallback(function handleMarkWorkspaceDone(
    workspaceId: string,
    logicalWorkspaceId: string,
  ) {
    void markDone(workspaceId, { logicalWorkspaceId }).catch((error) => {
      showErrorToast({
        headline: "Workspace not deleted",
        consequence: "It is still in your sidebar with its files intact.",
        cause: errorMessage(error),
        retry: () => handleMarkWorkspaceDone(workspaceId, logicalWorkspaceId),
      });
    });
  }, [markDone, showErrorToast]);


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
    handleGoHomeForRepository,
    handleStartWorktreeWorkspaceCreation,
    handleGoWorkflows,
    handleGoWorkspaces,
    handleSidebarIndicatorAction,
    handleOpenPullRequest,
    handleMarkWorkspaceDone,
    handleSelectWorkspace,
    handleCreateLocalWorkspace,
    handleCreateWorktreeWorkspace,
    handleCreateCloudWorkspace,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
