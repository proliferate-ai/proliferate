import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/use-configured-launch-readiness";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { isSessionModelAvailabilityInterruption } from "@/hooks/sessions/use-session-model-availability-workflow";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/tabs/use-chat-tab-visibility-actions";
import { useWorkspaceHeaderTabsModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-model";
import { resolveWorkspaceShellTabsState } from "@/lib/domain/workspaces/tabs/shell-tab-state";
import {
  fileWorkspaceShellTabKey,
  resolveRelativeWorkspaceShellTab,
  type WorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceTabsStore } from "@/stores/workspaces/workspace-tabs-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

const EMPTY_SHELL_TAB_ORDER_KEYS: readonly string[] = [];

export function useWorkspaceCommandPaletteTabs() {
  const model = useWorkspaceHeaderTabsModel();
  const selectedWorkspaceId = model.selectedWorkspaceId;
  const tabStore = useWorkspaceTabsStore(useShallow((state) => ({
    storedActiveShellTabKey: selectedWorkspaceId
      ? state.activeShellTabKeyByWorkspace[selectedWorkspaceId] ?? null
      : null,
    persistedShellOrderKeys: selectedWorkspaceId
      ? state.shellTabOrderByWorkspace[selectedWorkspaceId] ?? EMPTY_SHELL_TAB_ORDER_KEYS
      : EMPTY_SHELL_TAB_ORDER_KEYS,
    setActiveShellTabKey: state.setActiveShellTabKey,
  })));
  const setActiveTab = useWorkspaceFilesStore((state) => state.setActiveTab);
  const showToast = useToastStore((state) => state.show);
  const visibilityActions = useChatTabVisibilityActions({
    visibleIds: model.visibleChatSessionIds,
    liveIds: model.liveChatSessionIds,
    childToParent: model.childToParent,
  });
  const { currentLaunchIdentity } = useActiveChatSessionState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);
  const { createEmptySessionWithResolvedConfig } = useSessionActions();

  const shellState = useMemo(
    () => resolveWorkspaceShellTabsState({
      selectedWorkspaceId,
      activeSessionId: model.activeSessionId,
      storedActiveShellTabKey: tabStore.storedActiveShellTabKey,
      persistedShellOrderKeys: tabStore.persistedShellOrderKeys,
      shellChatSessionIds: model.stripVisibleChatSessionIds,
      openTabs: model.openTabs,
      stripRows: model.stripRows,
      displayManualGroups: model.displayManualGroups,
      subagentChildIdsByParentId: model.hierarchyChildIdsByParentSessionId,
    }),
    [
      model.activeSessionId,
      model.displayManualGroups,
      model.hierarchyChildIdsByParentSessionId,
      model.openTabs,
      model.stripRows,
      model.stripVisibleChatSessionIds,
      selectedWorkspaceId,
      tabStore.persistedShellOrderKeys,
      tabStore.storedActiveShellTabKey,
    ],
  );

  const activateWorkspaceTab = useCallback((tab: WorkspaceShellTab) => {
    if (tab.kind === "chat") {
      return visibilityActions.showChatSessionTab(tab.sessionId, { select: true });
    }
    if (!selectedWorkspaceId) {
      return false;
    }
    setActiveTab(tab.path);
    tabStore.setActiveShellTabKey(
      selectedWorkspaceId,
      fileWorkspaceShellTabKey(tab.path),
    );
    return true;
  }, [
    selectedWorkspaceId,
    setActiveTab,
    tabStore,
    visibilityActions,
  ]);

  const activateRelativeTab = useCallback((delta: number) => {
    const nextTab = resolveRelativeWorkspaceShellTab({
      tabs: shellState.orderedTabs,
      activeTab: shellState.activeShellTab,
      delta,
    });
    if (!nextTab) {
      return false;
    }
    return activateWorkspaceTab(nextTab);
  }, [activateWorkspaceTab, shellState.activeShellTab, shellState.orderedTabs]);

  const restoreLastDismissedTab = useCallback(
    () => visibilityActions.restoreHiddenOrDismissedChatTab(),
    [visibilityActions],
  );

  const openNewSessionTab = useCallback(() => {
    if (!selectedWorkspaceId) {
      return false;
    }
    const selection = currentLaunchIdentity ?? configuredLaunch.selection;
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
      if (isSessionModelAvailabilityInterruption(error)) {
        return;
      }
      failLatencyFlow(latencyFlowId, "session_create_failed");
      showToast(error instanceof Error ? error.message : String(error));
    });
    return true;
  }, [
    configuredLaunch.selection,
    createEmptySessionWithResolvedConfig,
    currentLaunchIdentity,
    selectedWorkspaceId,
    showToast,
  ]);

  const newSessionDisabledReason = selectedWorkspaceId
    ? currentLaunchIdentity
      ? null
      : configuredLaunch.disabledReason
    : "Workspace is still opening.";
  const hasMultipleTabs = shellState.orderedTabs.length > 1;

  return {
    activeSessionId: model.activeSessionId,
    activeShellTab: shellState.activeShellTab,
    orderedTabs: shellState.orderedTabs,
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
