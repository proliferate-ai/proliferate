import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Workspace } from "@anyharness/sdk";
import { APP_ROUTES } from "@/config/app-routes";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useCloudBilling } from "@/hooks/cloud/facade/use-cloud-billing";
import { useCreateCloudWorkspace } from "@/hooks/cloud/workflows/use-create-cloud-workspace";
import { useHomeNextRepositorySelection } from "@/hooks/home/derived/use-home-next-repository-selection";
import { useHomeNextTargetSelectionSnapshot } from "@/hooks/home/ui/use-home-next-target-selection-state";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { buildCloudRepoSettingsHref } from "@/lib/domain/settings/navigation";
import {
  buildConfiguredCloudRepoKeys,
  resolveCloudRepoActionState,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import {
  buildRepositoryNewWorkspaceCommandScope,
  buildSelectedWorkspaceNewWorkspaceCommandScope,
  resolveNewWorkspaceCommandTarget,
} from "@/lib/domain/workspaces/creation/new-workspace-command";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useNewWorkspaceCommandScopeStore } from "@/stores/workspaces/new-workspace-command-scope-store";
import type { AppCommandActions, AppCommandInvocation } from "./app-command-action-types";

const EMPTY_WORKSPACES: Workspace[] = [];

export type AppNewWorkspaceCommandActions = Pick<
  AppCommandActions,
  "newLocalWorkspace" | "newWorktreeWorkspace" | "newCloudWorkspace"
>;

// Owns workspace creation commands exposed at the global app command surface.
export function useAppNewWorkspaceCommandActions(): AppNewWorkspaceCommandActions {
  const navigate = useNavigate();
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
  const { cloudActive } = useCloudAvailabilityState();
  const { data: billingPlan } = useCloudBilling();
  const {
    data: cloudRepoConfigs,
    isPending: isCloudRepoConfigsPending,
  } = useCloudRepoConfigs(cloudActive);
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
  const {
    createCloudWorkspaceAndEnter,
    isCreatingCloudWorkspace,
  } = useCreateCloudWorkspace();

  const configuredCloudRepoKeys = useMemo(
    () => buildConfiguredCloudRepoKeys(cloudRepoConfigs?.configs),
    [cloudRepoConfigs?.configs],
  );
  const cloudRepoConfigsInitialLoading = cloudActive
    && isCloudRepoConfigsPending
    && !cloudRepoConfigs;
  const cloudWorkspaceBlocked = billingPlan?.billingMode === "enforce" && billingPlan.startBlocked;
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
    );
  }, [
    homeTargetSelection.destination,
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
  const commandCloudRepoAction = useMemo(
    () => resolveCloudRepoActionState({
      repoTarget: newWorkspaceCommandScope?.cloudRepoTarget ?? null,
      configuredRepoKeys: configuredCloudRepoKeys,
      isInitialConfigLoad: cloudRepoConfigsInitialLoading,
    }),
    [
      cloudRepoConfigsInitialLoading,
      configuredCloudRepoKeys,
      newWorkspaceCommandScope?.cloudRepoTarget,
    ],
  );

  const showDisabledShortcutToast = useCallback((
    invocation: AppCommandInvocation,
    reason: string,
  ) => {
    if (invocation === "shortcut") {
      showToast(reason);
    }
  }, [showToast]);
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

  const cloudUnavailableReason = !cloudActive
    ? "Cloud workspaces are unavailable."
    : cloudWorkspaceBlocked
      ? "Cloud workspaces are blocked by billing."
      : null;
  const newCloudCommandTarget = useMemo(() => resolveNewWorkspaceCommandTarget({
    commandKind: "cloud",
    scope: newWorkspaceCommandScope,
    busyReason: isCreatingCloudWorkspace ? "Action already in progress." : null,
    cloudUnavailableReason,
    cloudRepoAction: commandCloudRepoAction,
  }), [
    cloudUnavailableReason,
    commandCloudRepoAction,
    isCreatingCloudWorkspace,
    newWorkspaceCommandScope,
  ]);
  const newCloudWorkspace = useCallback((invocation: AppCommandInvocation) => {
    if (newCloudCommandTarget.disabledReason !== null) {
      showDisabledShortcutToast(invocation, newCloudCommandTarget.disabledReason);
      return;
    }
    if (newCloudCommandTarget.cloudActionKind === "configure") {
      navigate(buildCloudRepoSettingsHref(
        newCloudCommandTarget.target.gitOwner,
        newCloudCommandTarget.target.gitRepoName,
      ));
      return;
    }

    navigateToWorkspaceShell();
    const latencyFlowId = startLatencyFlow({
      flowKind: "cloud_workspace_create",
      source: invocation,
    });
    void createCloudWorkspaceAndEnter(newCloudCommandTarget.target, {
      latencyFlowId,
      repoGroupKeyToExpand: newCloudCommandTarget.repoGroupKeyToExpand,
    });
  }, [
    createCloudWorkspaceAndEnter,
    navigate,
    navigateToWorkspaceShell,
    newCloudCommandTarget,
    showDisabledShortcutToast,
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
    newCloudWorkspace: {
      execute: newCloudWorkspace,
      disabledReason: newCloudCommandTarget.disabledReason,
    },
  }), [
    newCloudCommandTarget.disabledReason,
    newCloudWorkspace,
    newLocalCommandTarget.disabledReason,
    newLocalWorkspace,
    newWorktreeCommandTarget.disabledReason,
    newWorktreeWorkspace,
  ]);
}
