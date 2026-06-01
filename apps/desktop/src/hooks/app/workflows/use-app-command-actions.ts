import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Workspace } from "@anyharness/sdk";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useCloudBilling } from "@/hooks/cloud/facade/use-cloud-billing";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useCreateCloudWorkspace } from "@/hooks/cloud/workflows/use-create-cloud-workspace";
import { useSelectedLogicalWorkspace } from "@/hooks/workspaces/derived/use-selected-logical-workspace";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import { useWorkspaceCopyActions } from "@/hooks/workspaces/workflows/use-workspace-copy-actions";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { useHomeNextTargetSelectionSnapshot } from "@/hooks/home/ui/use-home-next-target-selection-state";
import { useHomeNextRepositorySelection } from "@/hooks/home/derived/use-home-next-repository-selection";
import { APP_ROUTES } from "@/config/app-routes";
import { requestSupportDialog } from "@/lib/infra/support/support-dialog-request";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { buildCloudRepoSettingsHref, buildSettingsHref } from "@/lib/domain/settings/navigation";
import {
  buildConfiguredCloudRepoKeys,
  resolveCloudRepoActionState,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import {
  buildRepositoryNewWorkspaceCommandScope,
  buildSelectedWorkspaceNewWorkspaceCommandScope,
  resolveNewWorkspaceCommandTarget,
} from "@/lib/domain/workspaces/creation/new-workspace-command";
import { workspaceCopyMetadataForLogicalWorkspace } from "@/lib/domain/workspaces/workspace-copy-metadata";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useNewWorkspaceCommandScopeStore } from "@/stores/workspaces/new-workspace-command-scope-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";

const EMPTY_WORKSPACES: Workspace[] = [];

export type AppCommandInvocation = "shortcut" | "palette";

export interface AppCommandAction {
  execute: (invocation: AppCommandInvocation) => void;
  disabledReason: string | null;
}

export interface AppCommandActions {
  openSettings: AppCommandAction;
  showKeyboardShortcuts: AppCommandAction;
  goHome: AppCommandAction;
  goPlugins: AppCommandAction;
  goAutomations: AppCommandAction;
  openWebApp: AppCommandAction;
  openSupport: AppCommandAction;
  addRepository: AppCommandAction;
  newLocalWorkspace: AppCommandAction;
  newWorktreeWorkspace: AppCommandAction;
  newCloudWorkspace: AppCommandAction;
  copyWorkspacePath: AppCommandAction;
  copyBranchName: AppCommandAction;
}

// Owns global app command callbacks for shortcuts and the command palette.
// The hook wires existing workspace/cloud workflows into one command surface.
export function useAppCommandActions(): AppCommandActions {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const showToast = useToastStore((state) => state.show);
  const { openExternal } = useTauriShellActions();
  const { goToTopLevelRoute, navigateToWorkspaceShell } = useWorkspaceNavigationWorkflow();
  const { selectedLogicalWorkspace } = useSelectedLogicalWorkspace();
  const { copyWorkspaceLocation, copyBranchName } = useWorkspaceCopyActions();
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
  const {
    addRepoFromPicker,
    canAddRepo,
    addRepoDisabledReason,
    isAddingRepo,
  } = useAddRepo();

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
  const selectedWorkspaceCopyMetadata = useMemo(
    () => workspaceCopyMetadataForLogicalWorkspace(selectedLogicalWorkspace),
    [selectedLogicalWorkspace],
  );

  const openSettings = useCallback(() => {
    navigate("/settings");
  }, [navigate]);
  const showKeyboardShortcuts = useCallback(() => {
    navigate(buildSettingsHref({ section: "keyboard" }));
  }, [navigate]);
  const goHome = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.home);
  }, [goToTopLevelRoute]);
  const goPlugins = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.plugins);
  }, [goToTopLevelRoute]);
  const goAutomations = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.automations);
  }, [goToTopLevelRoute]);
  const openWebApp = useCallback(() => {
    showToast("Opening web app...", "info");
    void openExternal(getProliferateWebBaseUrl()).catch(() => {
      showToast("Failed to open the web app.");
    });
  }, [openExternal, showToast]);
  const openSupport = useCallback(() => {
    requestSupportDialog();
  }, []);

  const addRepositoryDisabledReason = isAddingRepo
    ? "Action already in progress."
    : canAddRepo
      ? null
      : addRepoDisabledReason;
  const addRepository = useCallback(() => {
    if (addRepositoryDisabledReason) {
      return;
    }
    void addRepoFromPicker();
  }, [addRepoFromPicker, addRepositoryDisabledReason]);

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
  const newLocalDisabledReason = newLocalCommandTarget.disabledReason;
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
  const newWorktreeDisabledReason = newWorktreeCommandTarget.disabledReason;
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
  const newCloudDisabledReason = newCloudCommandTarget.disabledReason;
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
  const copyWorkspacePathAction = useCallback(() => {
    void copyWorkspaceLocation(selectedWorkspaceCopyMetadata.workspaceLocation);
  }, [copyWorkspaceLocation, selectedWorkspaceCopyMetadata.workspaceLocation]);
  const copyBranchNameAction = useCallback(() => {
    void copyBranchName(selectedWorkspaceCopyMetadata.branchName);
  }, [copyBranchName, selectedWorkspaceCopyMetadata.branchName]);

  return useMemo<AppCommandActions>(() => ({
    openSettings: {
      execute: openSettings,
      disabledReason: null,
    },
    showKeyboardShortcuts: {
      execute: showKeyboardShortcuts,
      disabledReason: null,
    },
    goHome: {
      execute: goHome,
      disabledReason: null,
    },
    goPlugins: {
      execute: goPlugins,
      disabledReason: null,
    },
    goAutomations: {
      execute: goAutomations,
      disabledReason: null,
    },
    openWebApp: {
      execute: openWebApp,
      disabledReason: null,
    },
    openSupport: {
      execute: openSupport,
      disabledReason: null,
    },
    addRepository: {
      execute: addRepository,
      disabledReason: addRepositoryDisabledReason,
    },
    newLocalWorkspace: {
      execute: newLocalWorkspace,
      disabledReason: newLocalDisabledReason,
    },
    newWorktreeWorkspace: {
      execute: newWorktreeWorkspace,
      disabledReason: newWorktreeDisabledReason,
    },
    newCloudWorkspace: {
      execute: newCloudWorkspace,
      disabledReason: newCloudDisabledReason,
    },
    copyWorkspacePath: {
      execute: copyWorkspacePathAction,
      disabledReason: selectedWorkspaceCopyMetadata.workspaceLocation
        ? null
        : "Selected workspace has no path or repository.",
    },
    copyBranchName: {
      execute: copyBranchNameAction,
      disabledReason: selectedWorkspaceCopyMetadata.branchName
        ? null
        : "Selected workspace has no branch.",
    },
  }), [
    addRepository,
    addRepositoryDisabledReason,
    copyBranchNameAction,
    copyWorkspacePathAction,
    newCloudDisabledReason,
    newCloudWorkspace,
    newLocalDisabledReason,
    newLocalWorkspace,
    newWorktreeDisabledReason,
    newWorktreeWorkspace,
    goHome,
    goPlugins,
    goAutomations,
    openWebApp,
    openSupport,
    openSettings,
    selectedWorkspaceCopyMetadata.branchName,
    selectedWorkspaceCopyMetadata.workspaceLocation,
    showKeyboardShortcuts,
  ]);
}
