import { useCallback } from "react";
import { useActiveSessionLaunchState } from "@/hooks/chat/use-active-chat-session-selectors";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/use-configured-launch-readiness";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { isSessionModelAvailabilityInterruption } from "@/hooks/sessions/use-session-model-availability-workflow";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/tabs/use-chat-tab-visibility-actions";
import { useWorkspaceHeaderTabsViewModel } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import {
  resolveRelativeWorkspaceShellTab,
  type WorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

export function useWorkspaceCommandPaletteTabs() {
  const model = useWorkspaceHeaderTabsViewModel();
  const selectedWorkspaceId = model.selectedWorkspaceId;
  const showToast = useToastStore((state) => state.show);
  const { activateFileTab } = useWorkspaceShellActivation();
  const visibilityActions = useChatTabVisibilityActions({
    workspaceUiKey: model.workspaceUiKey,
    materializedWorkspaceId: model.materializedWorkspaceId,
    visibleIds: model.visibleChatSessionIds,
    liveIds: model.liveChatSessionIds,
    childToParent: model.childToParent,
  });
  const { currentLaunchIdentity } = useActiveSessionLaunchState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);
  const { createEmptySessionWithResolvedConfig } = useSessionActions();

  const activateWorkspaceTab = useCallback((tab: WorkspaceShellTab) => {
    if (tab.kind === "chat") {
      return visibilityActions.showChatSessionTab(tab.sessionId, { select: true });
    }
    if (!selectedWorkspaceId) {
      return false;
    }
    activateFileTab({
      workspaceId: selectedWorkspaceId,
      shellWorkspaceId: model.workspaceUiKey,
      path: tab.path,
      mode: "focus-existing",
    });
    return true;
  }, [
    activateFileTab,
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
