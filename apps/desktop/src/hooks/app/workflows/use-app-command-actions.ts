import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Workspace } from "@anyharness/sdk";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useCloudBilling } from "@/hooks/cloud/facade/use-cloud-billing";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useCreateCloudWorkspace } from "@/hooks/cloud/workflows/use-create-cloud-workspace";
import { useSelectedLogicalWorkspace } from "@/hooks/workspaces/derived/use-selected-logical-workspace";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/use-workspace-entry-actions";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import { useWorkspaceCopyActions } from "@/hooks/workspaces/workflows/use-workspace-copy-actions";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { APP_ROUTES } from "@/config/app-routes";
import { requestSupportDialog } from "@/lib/infra/support/support-dialog-request";
import { buildCloudRepoSettingsHref, buildSettingsHref } from "@/lib/domain/settings/navigation";
import {
  buildConfiguredCloudRepoKeys,
  resolveCloudRepoActionState,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import { getCloudRepoTargetForSelectedWorkspace, getRepoForSelectedWorkspace } from "@/lib/domain/workspaces/cloud/selected-repo-target";
import {
  sidebarRepoGroupKeyForCloudTarget,
  sidebarRepoGroupKeyForWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-group-key";
import { workspaceCopyMetadataForLogicalWorkspace } from "@/lib/domain/workspaces/workspace-copy-metadata";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
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
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const showToast = useToastStore((state) => state.show);
  const { goToTopLevelRoute } = useWorkspaceNavigationWorkflow();
  const { selectedLogicalWorkspace } = useSelectedLogicalWorkspace();
  const { copyWorkspaceLocation, copyBranchName } = useWorkspaceCopyActions();
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
  const selectedRepoContext = useMemo(
    () => getRepoForSelectedWorkspace(selectedWorkspaceId, workspaces),
    [selectedWorkspaceId, workspaces],
  );
  const selectedCloudTarget = useMemo(
    () => getCloudRepoTargetForSelectedWorkspace(
      selectedWorkspaceId,
      workspaces,
      cloudWorkspaces,
    ),
    [cloudWorkspaces, selectedWorkspaceId, workspaces],
  );
  const cloudRepoAction = useMemo(
    () => resolveCloudRepoActionState({
      repoTarget: selectedCloudTarget,
      configuredRepoKeys: configuredCloudRepoKeys,
      isInitialConfigLoad: cloudRepoConfigsInitialLoading,
    }),
    [cloudRepoConfigsInitialLoading, configuredCloudRepoKeys, selectedCloudTarget],
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

  const sourceRoot = selectedRepoContext?.repoWs.sourceRepoRootPath?.trim() ?? "";
  const newLocalDisabledReason = isCreatingLocalWorkspace
    ? "Action already in progress."
    : selectedRepoContext?.repoWs && sourceRoot
      ? null
      : "Select a repository workspace first.";
  const newLocalWorkspace = useCallback(() => {
    if (newLocalDisabledReason || !selectedRepoContext?.repoWs || !sourceRoot) {
      return;
    }

    void createLocalWorkspaceAndEnter(sourceRoot, {
      repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(selectedRepoContext.repoWs, repoRoots),
    }).catch((error) => {
      showToast(error instanceof Error ? error.message : "Failed to create workspace.");
    });
  }, [
    createLocalWorkspaceAndEnter,
    newLocalDisabledReason,
    repoRoots,
    selectedRepoContext?.repoWs,
    showToast,
    sourceRoot,
  ]);

  const repoRootId = selectedRepoContext?.repoWs.repoRootId?.trim() ?? "";
  const newWorktreeDisabledReason = isCreatingWorktreeWorkspace
    ? "Action already in progress."
    : selectedRepoContext?.repoWs && repoRootId
      ? null
      : "Select a repository workspace first.";
  const newWorktreeWorkspace = useCallback((invocation: AppCommandInvocation) => {
    if (newWorktreeDisabledReason || !selectedRepoContext?.repoWs || !repoRootId) {
      return;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "worktree_enter",
      source: invocation,
      targetWorkspaceId: repoRootId,
    });
    void createWorktreeAndEnter({
      repoRootId,
      sourceWorkspaceId: selectedRepoContext.repoWs.id,
    }, {
      latencyFlowId,
      repoGroupKeyToExpand: sidebarRepoGroupKeyForWorkspace(selectedRepoContext.repoWs, repoRoots),
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "worktree_enter_failed");
      showToast(error instanceof Error ? error.message : "Failed to create worktree.");
    });
  }, [
    createWorktreeAndEnter,
    newWorktreeDisabledReason,
    repoRootId,
    repoRoots,
    selectedRepoContext?.repoWs,
    showToast,
  ]);

  const newCloudDisabledReason = (() => {
    if (isCreatingCloudWorkspace) {
      return "Action already in progress.";
    }
    if (!cloudActive) {
      return "Cloud workspaces are unavailable.";
    }
    if (cloudWorkspaceBlocked) {
      return "Cloud workspaces are blocked by billing.";
    }
    if (!selectedCloudTarget || cloudRepoAction.kind === "hidden") {
      return "Select a repository workspace first.";
    }
    if (cloudRepoAction.kind === "loading") {
      return "Cloud repository settings are loading.";
    }
    return null;
  })();
  const newCloudWorkspace = useCallback((invocation: AppCommandInvocation) => {
    if (newCloudDisabledReason || !selectedCloudTarget) {
      return;
    }
    if (cloudRepoAction.kind === "configure") {
      navigate(buildCloudRepoSettingsHref(selectedCloudTarget.gitOwner, selectedCloudTarget.gitRepoName));
      return;
    }
    if (cloudRepoAction.kind !== "create") {
      return;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "cloud_workspace_create",
      source: invocation,
    });
    void createCloudWorkspaceAndEnter(selectedCloudTarget, {
      latencyFlowId,
      repoGroupKeyToExpand: sidebarRepoGroupKeyForCloudTarget(selectedCloudTarget, repoRoots),
    });
  }, [
    cloudRepoAction.kind,
    createCloudWorkspaceAndEnter,
    navigate,
    newCloudDisabledReason,
    repoRoots,
    selectedCloudTarget,
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
    openSupport,
    openSettings,
    selectedWorkspaceCopyMetadata.branchName,
    selectedWorkspaceCopyMetadata.workspaceLocation,
    showKeyboardShortcuts,
  ]);
}
