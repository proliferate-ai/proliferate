import { useCallback } from "react";
import { useActiveSessionLaunchState } from "#product/hooks/chat/derived/use-active-session-config-state";
import { useConfiguredLaunchReadiness } from "#product/hooks/chat/derived/use-configured-launch-readiness";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import { isWorkspaceDirectoryMissingError } from "#product/lib/domain/sessions/creation/create-session-error";
import { useChatTabVisibilityActions } from "#product/hooks/workspaces/workflows/tabs/use-chat-tab-visibility-actions";
import { useWorkspaceHeaderTabsViewModel } from "#product/hooks/workspaces/facade/tabs/use-workspace-header-tabs-view-model";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import {
  resolveRelativeWorkspaceShellTab,
  type WorkspaceShellTab,
} from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { resolveAvailableLaunchSelection } from "#product/lib/domain/chat/models/launch-selection-defaults";
import { useToastStore } from "#product/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";

// Owns command-palette tab actions. It does not build palette entries.
export function useWorkspaceCommandPaletteTabs() {
  const model = useWorkspaceHeaderTabsViewModel();
  const selectedWorkspaceId = model.selectedWorkspaceId;
  const showToast = useToastStore((state) => state.show);
  const { activateViewerTarget } = useWorkspaceShellActivation();
  const visibilityActions = useChatTabVisibilityActions({
    workspaceUiKey: model.workspaceUiKey,
    materializedWorkspaceId: model.materializedWorkspaceId,
    visibleIds: model.visibleChatSessionIds,
    liveIds: model.liveChatSessionIds,
    childToParent: model.childToParent,
  });
  const { currentLaunchIdentity } = useActiveSessionLaunchState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);
  const { createEmptySessionWithResolvedConfig } = useSessionCreationActions();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);

  const activateWorkspaceTab = useCallback((tab: WorkspaceShellTab) => {
    if (tab.kind === "chat") {
      return visibilityActions.showChatSessionTab(tab.sessionId, { select: true });
    }
    if (!selectedWorkspaceId) {
      return false;
    }
    activateViewerTarget({
      workspaceId: selectedWorkspaceId,
      shellWorkspaceId: model.workspaceUiKey,
      target: tab.target,
      mode: "focus-existing",
    });
    return true;
  }, [
    activateViewerTarget,
    model.workspaceUiKey,
    selectedWorkspaceId,
    visibilityActions,
  ]);

  const activateRelativeTab = useCallback((delta: number) => {
    const nextTab = resolveRelativeWorkspaceShellTab({
      tabs: model.orderedTabs,
      activeTab: model.activeShellTab,
      delta,
    });
    if (!nextTab) {
      return false;
    }
    return activateWorkspaceTab(nextTab);
  }, [activateWorkspaceTab, model.activeShellTab, model.orderedTabs]);

  const restoreLastDismissedTab = useCallback(
    () => visibilityActions.restoreHiddenOrDismissedChatTab(),
    [visibilityActions],
  );

  const openNewSessionTab = useCallback(() => {
    if (!selectedWorkspaceId || runtimeBlockReason) {
      return false;
    }
    const selection = resolveAvailableLaunchSelection(
      configuredLaunch.launchCatalog.launchAgents,
      currentLaunchIdentity,
      configuredLaunch.selection,
    );
    if (!selection) {
      return false;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_create",
      source: "command_palette",
      targetWorkspaceId: selectedWorkspaceId,
    });
    void createEmptySessionWithResolvedConfig({
      agentKind: selection.kind,
      modelId: selection.modelId,
      latencyFlowId,
      reuseInFlightEmptySession: false,
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "session_create_failed");
      // The persistent missing-worktree composer panel owns that condition.
      if (!isWorkspaceDirectoryMissingError(error)) {
        showToast(error instanceof Error ? error.message : String(error));
      }
    });
    return true;
  }, [
    configuredLaunch.selection,
    configuredLaunch.launchCatalog.launchAgents,
    createEmptySessionWithResolvedConfig,
    currentLaunchIdentity,
    runtimeBlockReason,
    selectedWorkspaceId,
    showToast,
  ]);

  const newSessionSelection = resolveAvailableLaunchSelection(
    configuredLaunch.launchCatalog.launchAgents,
    currentLaunchIdentity,
    configuredLaunch.selection,
  );
  const newSessionDisabledReason = selectedWorkspaceId
    ? runtimeBlockReason ?? (newSessionSelection ? null : configuredLaunch.disabledReason)
    : "Workspace is still opening.";
  const hasMultipleTabs = model.orderedTabs.length > 1;

  return {
    activeSessionId: model.activeSessionId,
    activeShellTab: model.activeShellTab,
    orderedTabs: model.orderedTabs,
    canActivateRelativeTab: selectedWorkspaceId !== null && hasMultipleTabs,
    relativeTabDisabledReason: selectedWorkspaceId
      ? hasMultipleTabs
        ? null
        : "No other tab."
      : "Workspace is still opening.",
    canOpenNewSessionTab: newSessionDisabledReason === null,
    newSessionDisabledReason,
    openNewSessionTab,
    activateRelativeTab,
    restoreLastDismissedTab,
    restoreTabDisabledReason: selectedWorkspaceId ? null : "Workspace is still opening.",
  };
}
