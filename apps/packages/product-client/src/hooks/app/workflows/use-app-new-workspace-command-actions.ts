import { useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { Workspace } from "@anyharness/sdk";
import { APP_ROUTES } from "#product/config/app-routes";
import { useHomeNextRepositorySelection } from "#product/hooks/home/derived/use-home-next-repository-selection";
import { useHomeNextTargetSelectionSnapshot } from "#product/hooks/home/ui/use-home-next-target-selection-state";
import { useStandardRepoProjection } from "#product/hooks/workspaces/derived/use-standard-repo-projection";
import { useWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import {
  buildRepositoryNewWorkspaceCommandScope,
  buildSelectedWorkspaceNewWorkspaceCommandScope,
  resolveNewWorkspaceCommandTarget,
} from "#product/lib/domain/workspaces/creation/new-workspace-command";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useNewWorkspaceCommandScopeStore } from "#product/stores/workspaces/new-workspace-command-scope-store";
import type { AppCommandActions, AppCommandInvocation } from "#product/hooks/app/workflows/app-command-action-types";

const EMPTY_WORKSPACES: Workspace[] = [];

export type AppNewWorkspaceCommandActions = Pick<
  AppCommandActions,
  "newLocalWorkspace" | "newWorktreeWorkspace"
>;

// Owns workspace creation commands exposed at the global app command surface.
// Cloud creation is culled (PRO-10); only local and worktree remain.
export function useAppNewWorkspaceCommandActions(): AppNewWorkspaceCommandActions {
  const location = useLocation();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const showToast = useToastStore((state) => state.show);
  const { navigateToWorkspaceShell } = useWorkspaceNavigationWorkflow();
  const homeTargetSelection = useHomeNextTargetSelectionSnapshot();
  const homeRepositorySelection = useHomeNextRepositorySelection({
    destination: homeTargetSelection.destination,
    repositorySelection: homeTargetSelection.repositorySelection,
    repoLaunchKind: homeTargetSelection.repoLaunchKind,
    baseBranchOverride: homeTargetSelection.baseBranchOverride,
  });
  const activeNewWorkspaceScope = useNewWorkspaceCommandScopeStore((state) => state.activeScope);
  const {
    repoRoots,
    localWorkspaces,
    cloudWorkspaces,
  } = useStandardRepoProjection();
  const workspaces = localWorkspaces ?? EMPTY_WORKSPACES;
  const {
    createLocalWorkspaceAndEnter,
    isCreatingLocalWorkspace,
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
  } = useWorkspaceEntryActions();

  const showDisabledShortcutToast = useCallback((
    invocation: AppCommandInvocation,
    reason: string,
  ) => {
    if (invocation === "shortcut") {
      showToast(reason);
    }
  }, [showToast]);

  const homeNewWorkspaceScope = useMemo(() => {
    if (
      location.pathname !== APP_ROUTES.home
      || homeTargetSelection.destination !== "repository"
    ) {
      return null;
    }

    return buildRepositoryNewWorkspaceCommandScope(
      homeRepositorySelection.selectedRepository,
      homeRepositorySelection.selectedBranchName,
      "home",
      homeRepositorySelection.defaultBranchName,
    );
  }, [
    homeTargetSelection.destination,
    homeRepositorySelection.defaultBranchName,
    homeRepositorySelection.selectedBranchName,
    homeRepositorySelection.selectedRepository,
    location.pathname,
  ]);
  const selectedNewWorkspaceScope = useMemo(
    () => buildSelectedWorkspaceNewWorkspaceCommandScope({
      selectedWorkspaceId,
      workspaces,
      cloudWorkspaces,
      repoRoots,
    }),
    [cloudWorkspaces, repoRoots, selectedWorkspaceId, workspaces],
  );
  const newWorkspaceCommandScope =
    activeNewWorkspaceScope
    ?? homeNewWorkspaceScope
    ?? selectedNewWorkspaceScope;

  const newLocalCommandTarget = useMemo(() => resolveNewWorkspaceCommandTarget({
    commandKind: "local",
    scope: newWorkspaceCommandScope,
    busyReason: isCreatingLocalWorkspace ? "Action already in progress." : null,
  }), [isCreatingLocalWorkspace, newWorkspaceCommandScope]);
  const newLocalWorkspace = useCallback((invocation: AppCommandInvocation) => {
    if (newLocalCommandTarget.disabledReason !== null) {
      showDisabledShortcutToast(invocation, newLocalCommandTarget.disabledReason);
      return;
    }

    navigateToWorkspaceShell();
    void createLocalWorkspaceAndEnter(newLocalCommandTarget.sourceRoot, {
      repoGroupKeyToExpand: newLocalCommandTarget.repoGroupKeyToExpand,
    }).catch((error) => {
      showToast(error instanceof Error ? error.message : "Failed to create workspace.");
    });
  }, [
    createLocalWorkspaceAndEnter,
    navigateToWorkspaceShell,
    newLocalCommandTarget,
    showDisabledShortcutToast,
    showToast,
  ]);

  const newWorktreeCommandTarget = useMemo(() => resolveNewWorkspaceCommandTarget({
    commandKind: "worktree",
    scope: newWorkspaceCommandScope,
    busyReason: isCreatingWorktreeWorkspace ? "Action already in progress." : null,
  }), [isCreatingWorktreeWorkspace, newWorkspaceCommandScope]);
  const newWorktreeWorkspace = useCallback((invocation: AppCommandInvocation) => {
    if (newWorktreeCommandTarget.disabledReason !== null) {
      showDisabledShortcutToast(invocation, newWorktreeCommandTarget.disabledReason);
      return;
    }

    navigateToWorkspaceShell();
    const latencyFlowId = startLatencyFlow({
      flowKind: "worktree_enter",
      source: invocation,
      targetWorkspaceId: newWorktreeCommandTarget.repoRootId,
    });
    void createWorktreeAndEnter({
      repoRootId: newWorktreeCommandTarget.repoRootId,
      sourceWorkspaceId: newWorktreeCommandTarget.sourceWorkspaceId,
      baseBranch: newWorktreeCommandTarget.baseBranch ?? undefined,
      defaultBranch: newWorktreeCommandTarget.defaultBranch,
    }, {
      latencyFlowId,
      repoGroupKeyToExpand: newWorktreeCommandTarget.repoGroupKeyToExpand,
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "worktree_enter_failed");
      showToast(error instanceof Error ? error.message : "Failed to create worktree.");
    });
  }, [
    createWorktreeAndEnter,
    navigateToWorkspaceShell,
    newWorktreeCommandTarget,
    showDisabledShortcutToast,
    showToast,
  ]);

  return useMemo<AppNewWorkspaceCommandActions>(() => ({
    newLocalWorkspace: {
      execute: newLocalWorkspace,
      disabledReason: newLocalCommandTarget.disabledReason,
    },
    newWorktreeWorkspace: {
      execute: newWorktreeWorkspace,
      disabledReason: newWorktreeCommandTarget.disabledReason,
    },
  }), [
    newLocalCommandTarget.disabledReason,
    newLocalWorkspace,
    newWorktreeCommandTarget.disabledReason,
    newWorktreeWorkspace,
  ]);
}
