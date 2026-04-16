import { useMemo, useCallback } from "react";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/use-configured-launch-readiness";
import { useCloseActiveWorkspaceTab } from "@/hooks/workspaces/use-close-active-workspace-tab";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import {
  buildWorkspaceShellTabs,
  resolveActiveWorkspaceShellTab,
  resolveRelativeWorkspaceShellTab,
  resolveWorkspaceShellTabByShortcutIndex,
  type WorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

export function useWorkspaceTabActions() {
  const activeMainTab = useWorkspaceFilesStore((state) => state.activeMainTab);
  const openTabs = useWorkspaceFilesStore((state) => state.openTabs);
  const activateChatTab = useWorkspaceFilesStore((state) => state.activateChatTab);
  const setActiveTab = useWorkspaceFilesStore((state) => state.setActiveTab);

  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const sessionSlots = useHarnessStore((state) => state.sessionSlots);
  const showToast = useToastStore((state) => state.show);
  const closeActiveWorkspaceTab = useCloseActiveWorkspaceTab();

  const { currentLaunchIdentity } = useActiveChatSessionState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);
  const {
    openWorkspaceSessionWithResolvedConfig,
    restoreLastDismissedSession,
    selectSession,
  } = useSessionActions();

  const orderedTabs = useMemo(
    () => buildWorkspaceShellTabs({
      selectedWorkspaceId,
      sessionSlots,
      openTabs,
    }),
    [openTabs, selectedWorkspaceId, sessionSlots],
  );

  const activeTab = useMemo(
    () => resolveActiveWorkspaceShellTab({
      activeMainTab,
      activeSessionId,
    }),
    [activeMainTab, activeSessionId],
  );

  const activateWorkspaceTab = useCallback((tab: WorkspaceShellTab) => {
    if (tab.kind === "chat") {
      activateChatTab();
      const latencyFlowId = startLatencyFlow({
        flowKind: "session_switch",
        source: "workspace_tab",
        targetWorkspaceId: selectedWorkspaceId,
        targetSessionId: tab.sessionId,
      });
      void selectSession(tab.sessionId, { latencyFlowId }).catch((error) => {
        failLatencyFlow(latencyFlowId, "session_switch_failed");
        const message = error instanceof Error ? error.message : String(error);
        showToast(message);
      });
      return true;
    }

    setActiveTab(tab.path);
    return true;
  }, [activateChatTab, selectSession, selectedWorkspaceId, setActiveTab, showToast]);

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

  const restoreLastDismissedTab = useCallback(() => {
    if (!selectedWorkspaceId) {
      return false;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_restore",
      source: "workspace_tab",
      targetWorkspaceId: selectedWorkspaceId,
    });
    void restoreLastDismissedSession({ latencyFlowId }).catch((error) => {
      failLatencyFlow(latencyFlowId, "session_restore_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
    return true;
  }, [restoreLastDismissedSession, selectedWorkspaceId, showToast]);

  const openNewSessionTab = useCallback(() => {
    const selection = currentLaunchIdentity ?? configuredLaunch.selection;
    if (!selection) {
      return false;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_create",
      source: "workspace_tab",
      targetWorkspaceId: selectedWorkspaceId,
    });
    void openWorkspaceSessionWithResolvedConfig({
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
    openWorkspaceSessionWithResolvedConfig,
    selectedWorkspaceId,
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
