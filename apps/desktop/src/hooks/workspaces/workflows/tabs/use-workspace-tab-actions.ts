import { useCallback, useMemo } from "react";
import { useActiveSessionLaunchState } from "@/hooks/chat/derived/use-active-chat-session-selectors";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/derived/use-configured-launch-readiness";
import { useCloseActiveWorkspaceTab } from "@/hooks/workspaces/workflows/tabs/use-close-active-workspace-tab";
import { useChatTabVisibilityActions } from "@/hooks/workspaces/workflows/tabs/use-chat-tab-visibility-actions";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { useSessionCreationActions } from "@/hooks/sessions/workflows/use-session-creation-actions";
import {
  resolveWorkspaceShellTabFromKey,
  resolveRelativeWorkspaceShellTab,
  resolveWorkspaceShellTabByShortcutIndex,
  type WorkspaceShellTab,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { resolveAvailableLaunchSelection } from "@/lib/domain/chat/models/model-selection";
import { resolveStoredWorkspaceShellTab } from "@/lib/domain/workspaces/tabs/active-shell-tab";
import type {
  HeaderWorkspaceShellStripRow,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";

export interface WorkspaceTabActionsContext {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  visibleChatSessionIds: string[];
  liveChatSessionIds: string[];
  childToParent: Map<string, string>;
  shellRows: HeaderWorkspaceShellStripRow[];
  orderedTabs: WorkspaceShellTab[];
  activeShellTab: WorkspaceShellTab | null;
  activeShellTabKey: string | null;
}

export function useWorkspaceTabActions(headerTabs: WorkspaceTabActionsContext) {
  const { activateViewerTarget } = useWorkspaceShellActivation();
  const showToast = useToastStore((state) => state.show);
  const closeActiveWorkspaceTab = useCloseActiveWorkspaceTab(headerTabs);
  const chatVisibilityActions = useChatTabVisibilityActions({
    workspaceUiKey: headerTabs.workspaceUiKey,
    materializedWorkspaceId: headerTabs.materializedWorkspaceId,
    visibleIds: headerTabs.visibleChatSessionIds,
    liveIds: headerTabs.liveChatSessionIds,
    childToParent: headerTabs.childToParent,
  });

  const { currentLaunchIdentity } = useActiveSessionLaunchState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);
  const { createEmptySessionWithResolvedConfig } = useSessionCreationActions();

  const orderedTabs = headerTabs.orderedTabs;
  const visibleShortcutTabs = useMemo(
    () => headerTabs.shellRows.flatMap((shellRow): WorkspaceShellTab[] =>
      shellRow.kind === "chat" && shellRow.row.kind === "tab"
        ? [{ kind: "chat", sessionId: shellRow.row.tab.id }]
        : []
    ),
    [headerTabs.shellRows],
  );
  const activeTab = headerTabs.activeShellTab;

  const activateWorkspaceTab = useCallback((tab: WorkspaceShellTab) => {
    if (tab.kind === "chat") {
      return chatVisibilityActions.showChatSessionTab(tab.sessionId, { select: true });
    }

    if (headerTabs.selectedWorkspaceId) {
      activateViewerTarget({
        workspaceId: headerTabs.selectedWorkspaceId,
        shellWorkspaceId: headerTabs.workspaceUiKey,
        target: tab.target,
        mode: "focus-existing",
      });
    }
    return true;
  }, [
    activateViewerTarget,
    chatVisibilityActions,
    headerTabs.workspaceUiKey,
    headerTabs.selectedWorkspaceId,
  ]);

  const activateRelativeTab = useCallback((delta: number) => {
    const activeAnchor = resolveShortcutCycleAnchor({
      activeTab,
      activeShellTabKey: headerTabs.activeShellTabKey,
      materializedWorkspaceId: headerTabs.materializedWorkspaceId,
      orderedTabs,
      workspaceUiKey: headerTabs.workspaceUiKey,
    });
    const nextTab = resolveRelativeWorkspaceShellTab({
      tabs: orderedTabs,
      activeTab: activeAnchor,
      delta,
    });
    if (!nextTab) {
      return false;
    }

    return activateWorkspaceTab(nextTab);
  }, [
    activateWorkspaceTab,
    activeTab,
    headerTabs.activeShellTabKey,
    headerTabs.materializedWorkspaceId,
    headerTabs.workspaceUiKey,
    orderedTabs,
  ]);

  const activateTabByShortcutIndex = useCallback((key: string) => {
    const nextTab = resolveWorkspaceShellTabByShortcutIndex(visibleShortcutTabs, key);
    if (!nextTab) {
      return false;
    }

    return activateWorkspaceTab(nextTab);
  }, [activateWorkspaceTab, visibleShortcutTabs]);

  const restoreLastDismissedTab = useCallback(
    () => chatVisibilityActions.restoreHiddenOrDismissedChatTab(),
    [chatVisibilityActions],
  );

  const openNewSessionTab = useCallback(() => {
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
    configuredLaunch.launchCatalog.launchAgents,
    currentLaunchIdentity,
    createEmptySessionWithResolvedConfig,
    headerTabs.selectedWorkspaceId,
    showToast,
  ]);

  const canOpenNewSessionTab = Boolean(resolveAvailableLaunchSelection(
    configuredLaunch.launchCatalog.launchAgents,
    currentLaunchIdentity,
    configuredLaunch.selection,
  ));

  return {
    orderedTabs,
    activeTab,
    activateWorkspaceTab,
    activateRelativeTab,
    activateTabByShortcutIndex,
    closeActiveWorkspaceTab,
    canOpenNewSessionTab,
    newSessionDisabledReason: canOpenNewSessionTab ? null : configuredLaunch.disabledReason,
    openNewSessionTab,
    restoreLastDismissedTab,
  };
}

export type WorkspaceTabActions = ReturnType<typeof useWorkspaceTabActions>;

function resolveShortcutCycleAnchor({
  activeTab,
  activeShellTabKey,
  materializedWorkspaceId,
  orderedTabs,
  workspaceUiKey,
}: {
  activeTab: WorkspaceShellTab | null;
  activeShellTabKey: string | null;
  materializedWorkspaceId: string | null;
  orderedTabs: WorkspaceShellTab[];
  workspaceUiKey: string | null;
}): WorkspaceShellTab | null {
  if (!workspaceUiKey) {
    return activeTab;
  }

  const workspaceUiState = useWorkspaceUiStore.getState();
  const urgentHighlightedSessionId =
    workspaceUiState.urgentHighlightedChatSessionByWorkspace[workspaceUiKey] ?? null;
  if (urgentHighlightedSessionId) {
    return resolveWorkspaceShellTabFromKey(
      `chat:${urgentHighlightedSessionId}`,
      orderedTabs,
    ) ?? activeTab;
  }
  const pending = workspaceUiState.pendingChatActivationByWorkspace[workspaceUiKey] ?? null;
  const storedTab = resolveStoredWorkspaceShellTab({
    activeShellTabKey,
    materializedWorkspaceId,
    orderedTabs,
    state: workspaceUiState,
    workspaceUiKey,
  });
  if (!pending) {
    return storedTab ?? activeTab;
  }

  const selectionState = useSessionSelectionStore.getState();
  const guardWorkspaceId = materializedWorkspaceId ?? selectionState.selectedWorkspaceId;
  const shellEpoch = workspaceUiState.shellActivationEpochByWorkspace[workspaceUiKey] ?? 0;
  const durableIntent = workspaceUiState.activeShellTabKeyByWorkspace[workspaceUiKey] ?? null;
  const sessionEpoch = guardWorkspaceId
    ? selectionState.sessionActivationIntentEpochByWorkspace[guardWorkspaceId] ?? 0
    : 0;
  const pendingShellTargetIsCurrent =
    pending.shellEpochAtWrite === shellEpoch || durableIntent === pending.intent;
  const pendingIsCurrent = pendingShellTargetIsCurrent
    && pending.workspaceSelectionNonce === selectionState.workspaceSelectionNonce
    && pending.guardToken === sessionEpoch
    && pending.sessionActivationEpochAtWrite === sessionEpoch;
  if (!pendingIsCurrent) {
    return storedTab ?? activeTab;
  }

  return resolveWorkspaceShellTabFromKey(pending.intent, orderedTabs) ?? storedTab ?? activeTab;
}
