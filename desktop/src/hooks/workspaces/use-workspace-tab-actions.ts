import { useCallback } from "react";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/use-configured-launch-readiness";
import { useCloseActiveWorkspaceTab } from "@/hooks/workspaces/use-close-active-workspace-tab";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/tabs/use-chat-tab-visibility-actions";
import { useWorkspaceHeaderTabsViewModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import {
  fileWorkspaceShellTabKey,
  resolveRelativeWorkspaceShellTab,
  resolveWorkspaceShellTabByShortcutIndex,
  type WorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceTabsStore } from "@/stores/workspaces/workspace-tabs-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

export function useWorkspaceTabActions() {
  const setActiveTab = useWorkspaceFilesStore((state) => state.setActiveTab);
  const setActiveShellTabKey = useWorkspaceTabsStore((state) => state.setActiveShellTabKey);

  const headerTabs = useWorkspaceHeaderTabsViewModel();
  const showToast = useToastStore((state) => state.show);
  const closeActiveWorkspaceTab = useCloseActiveWorkspaceTab();
  const chatVisibilityActions = useChatTabVisibilityActions({
    visibleIds: headerTabs.visibleChatSessionIds,
    liveIds: headerTabs.liveChatSessionIds,
    childToParent: headerTabs.childToParent,
  });

  const { currentLaunchIdentity } = useActiveChatSessionState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);
  const {
    createEmptySessionWithResolvedConfig,
  } = useSessionActions();

  const orderedTabs = headerTabs.orderedTabs;
  const activeTab = headerTabs.activeShellTab;

  const activateWorkspaceTab = useCallback((tab: WorkspaceShellTab) => {
    if (tab.kind === "chat") {
      return chatVisibilityActions.showChatSessionTab(tab.sessionId, { select: true });
    }

    setActiveTab(tab.path);
    if (headerTabs.selectedWorkspaceId) {
      setActiveShellTabKey(
        headerTabs.selectedWorkspaceId,
        fileWorkspaceShellTabKey(tab.path),
      );
    }
    return true;
  }, [
    chatVisibilityActions,
    headerTabs.selectedWorkspaceId,
    setActiveShellTabKey,
    setActiveTab,
  ]);

  const activateRelativeTab = useCallback((delta: number) => {
    const nextTab = resolveRelativeWorkspaceShellTab({
      tabs: orderedTabs,
      activeTab,
      delta,
    });
    if (!nextTab) {
      return false;
    }

    return activateWorkspaceTab(nextTab);
  }, [activateWorkspaceTab, activeTab, orderedTabs]);

  const activateTabByShortcutIndex = useCallback((key: string) => {
    const nextTab = resolveWorkspaceShellTabByShortcutIndex(orderedTabs, key);
    if (!nextTab) {
      return false;
    }

    return activateWorkspaceTab(nextTab);
  }, [activateWorkspaceTab, orderedTabs]);

  const restoreLastDismissedTab = useCallback(
    () => chatVisibilityActions.restoreHiddenOrDismissedChatTab(),
    [chatVisibilityActions],
  );

  const openNewSessionTab = useCallback(() => {
    const selection = currentLaunchIdentity ?? configuredLaunch.selection;
    if (!selection) {
      return false;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_create",
      source: "workspace_tab",
      targetWorkspaceId: headerTabs.selectedWorkspaceId,
    });
    void createEmptySessionWithResolvedConfig({
      agentKind: selection.kind,
      modelId: selection.modelId,
      latencyFlowId,
      reuseInFlightEmptySession: false,
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "session_create_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
    return true;
  }, [
    configuredLaunch.selection,
    currentLaunchIdentity,
    createEmptySessionWithResolvedConfig,
    headerTabs.selectedWorkspaceId,
    showToast,
  ]);

  const canOpenNewSessionTab = Boolean(currentLaunchIdentity ?? configuredLaunch.selection);

  return {
    orderedTabs,
    activeTab,
    activateWorkspaceTab,
    activateRelativeTab,
    activateTabByShortcutIndex,
    closeActiveWorkspaceTab,
    canOpenNewSessionTab,
    newSessionDisabledReason: currentLaunchIdentity ? null : configuredLaunch.disabledReason,
    openNewSessionTab,
    restoreLastDismissedTab,
  };
}

export type WorkspaceTabActions = ReturnType<typeof useWorkspaceTabActions>;
