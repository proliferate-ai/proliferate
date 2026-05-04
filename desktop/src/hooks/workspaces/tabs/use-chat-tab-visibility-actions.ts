import { useCallback } from "react";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import {
  collectGroupIds,
  resolveFallbackAfterHidingChatTabs,
  resolveMostRecentHiddenChatTab,
  uniqueIds,
} from "@/lib/domain/workspaces/tabs/visibility";
import { resolveSessionErrorAttentionKey } from "@/lib/domain/sessions/activity";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { recordLinkedChildRelationshipHint } from "@/hooks/sessions/session-relationship-hints";

interface ChatTabVisibilityContext {
  workspaceUiKey?: string | null;
  materializedWorkspaceId?: string | null;
  visibleIds: string[];
  liveIds: string[];
  childToParent: Map<string, string>;
}

interface ShowOptions {
  select?: boolean;
}

interface HideOptions {
  selectFallback?: boolean;
}

export function useChatTabVisibilityActions(context: ChatTabVisibilityContext) {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const {
    childToParent,
    liveIds,
    visibleIds,
  } = context;
  const materializedWorkspaceId = context.materializedWorkspaceId ?? selectedWorkspaceId;
  const workspaceUiKey = context.workspaceUiKey ?? materializedWorkspaceId;
  const setVisibleChatSessionIdsForWorkspace = useWorkspaceUiStore(
    (state) => state.setVisibleChatSessionIdsForWorkspace,
  );
  const markSessionErrorViewed = useWorkspaceUiStore((state) => state.markSessionErrorViewed);
  const rememberHiddenChatSessionForWorkspace = useWorkspaceUiStore(
    (state) => state.rememberHiddenChatSessionForWorkspace,
  );
  const clearHiddenChatSessionsForWorkspace = useWorkspaceUiStore(
    (state) => state.clearHiddenChatSessionsForWorkspace,
  );
  const recentlyHiddenChatSessionIdsByWorkspace = useWorkspaceUiStore(
    (state) => state.recentlyHiddenChatSessionIdsByWorkspace,
  );
  const showToast = useToastStore((state) => state.show);
  const { restoreLastDismissedSession } = useSessionActions();
  const { activateChatShell, activateChatTab } = useWorkspaceShellActivation();

  const selectSessionId = useCallback((sessionId: string, source: string) => {
    if (!materializedWorkspaceId) {
      return;
    }
    const parentSessionId = childToParent.get(sessionId) ?? null;
    recordLinkedChildRelationshipHint({
      sessionId,
      parentSessionId,
      relation: "header_child",
      workspaceId: materializedWorkspaceId,
    });
    const latencyFlowId = startLatencyFlow({
      flowKind: "session_switch",
      source,
      targetWorkspaceId: materializedWorkspaceId,
      targetSessionId: sessionId,
    });
    void activateChatTab({
      workspaceId: materializedWorkspaceId,
      shellWorkspaceId: workspaceUiKey,
      sessionId,
      source,
      selection: { latencyFlowId },
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "session_switch_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [activateChatTab, childToParent, materializedWorkspaceId, showToast, workspaceUiKey]);

  const markErroredSessionsViewedBeforeHide = useCallback((idsToHide: string[]) => {
    if (idsToHide.length === 0) {
      return;
    }

    const { sessionSlots } = useHarnessStore.getState();
    for (const sessionId of idsToHide) {
      const errorAttentionKey = resolveSessionErrorAttentionKey(
        sessionSlots[sessionId] ?? null,
      );
      if (errorAttentionKey) {
        markSessionErrorViewed(sessionId, errorAttentionKey);
      }
    }
  }, [markSessionErrorViewed]);

  const showChatSessionTab = useCallback((sessionId: string, options?: ShowOptions) => {
    if (!workspaceUiKey) {
      return false;
    }

    const parentId = childToParent.get(sessionId);
    const idsToShow = parentId ? [parentId, sessionId] : [sessionId];
    const nextVisible = uniqueIds([...visibleIds, ...idsToShow]);
    setVisibleChatSessionIdsForWorkspace(workspaceUiKey, nextVisible);
    clearHiddenChatSessionsForWorkspace(workspaceUiKey, idsToShow);
    if (options?.select) {
      selectSessionId(sessionId, "header_tab");
    }
    return true;
  }, [
    clearHiddenChatSessionsForWorkspace,
    childToParent,
    selectSessionId,
    setVisibleChatSessionIdsForWorkspace,
    visibleIds,
    workspaceUiKey,
  ]);

  const hideChatSessionTabs = useCallback((sessionIds: string[], options?: HideOptions) => {
    if (!workspaceUiKey || !materializedWorkspaceId) {
      return false;
    }

    const expandedHideSet = new Set(sessionIds);
    for (const sessionId of sessionIds) {
      if (!childToParent.has(sessionId)) {
        for (const [childId, parentId] of childToParent) {
          if (parentId === sessionId) {
            expandedHideSet.add(childId);
          }
        }
      }
    }
    const idsToHide = [...expandedHideSet];
    const nextVisible = visibleIds.filter((id) => !expandedHideSet.has(id));
    markErroredSessionsViewedBeforeHide(idsToHide);
    setVisibleChatSessionIdsForWorkspace(workspaceUiKey, nextVisible);
    idsToHide.forEach((id) => rememberHiddenChatSessionForWorkspace(workspaceUiKey, id));

    if (options?.selectFallback) {
      const fallbackId = resolveFallbackAfterHidingChatTabs({
        visibleIdsBeforeHide: visibleIds,
        idsToHide,
        activeSessionId,
      });
      if (fallbackId) {
        selectSessionId(fallbackId, "header_tab");
      } else if (activeSessionId && expandedHideSet.has(activeSessionId)) {
        activateChatShell({
          workspaceId: materializedWorkspaceId,
          shellWorkspaceId: workspaceUiKey,
          reason: "active-chat-hidden",
        });
      }
    }

    return true;
  }, [
    activeSessionId,
    childToParent,
    markErroredSessionsViewedBeforeHide,
    materializedWorkspaceId,
    rememberHiddenChatSessionForWorkspace,
    selectSessionId,
    setVisibleChatSessionIdsForWorkspace,
    activateChatShell,
    visibleIds,
    workspaceUiKey,
  ]);

  const closeOtherChatSessionTabs = useCallback((anchorSessionId: string) => {
    if (!workspaceUiKey) {
      return false;
    }

    const parentId = childToParent.get(anchorSessionId);
    const rootId = parentId ?? anchorSessionId;
    const keepIds = parentId
      ? [parentId, anchorSessionId]
      : collectGroupIds({
        rootSessionId: rootId,
        visibleIds,
        childToParent,
      });
    const keepSet = new Set(keepIds);
    const idsToHide = visibleIds.filter((id) => !keepSet.has(id));
    markErroredSessionsViewedBeforeHide(idsToHide);
    setVisibleChatSessionIdsForWorkspace(workspaceUiKey, keepIds);
    idsToHide.forEach((id) => rememberHiddenChatSessionForWorkspace(workspaceUiKey, id));
    if (activeSessionId && !keepSet.has(activeSessionId)) {
      selectSessionId(anchorSessionId, "header_tab");
    }
    return true;
  }, [
    activeSessionId,
    childToParent,
    markErroredSessionsViewedBeforeHide,
    rememberHiddenChatSessionForWorkspace,
    selectSessionId,
    setVisibleChatSessionIdsForWorkspace,
    visibleIds,
    workspaceUiKey,
  ]);

  const closeChatSessionTabsToRight = useCallback((anchorSessionId: string) => {
    if (!workspaceUiKey) {
      return false;
    }

    const anchorIndex = visibleIds.indexOf(anchorSessionId);
    if (anchorIndex === -1) {
      return false;
    }

    const idsToHide = visibleIds.slice(anchorIndex + 1);
    const hideSet = new Set(idsToHide);
    const nextVisible = visibleIds.filter((id) => !hideSet.has(id));
    markErroredSessionsViewedBeforeHide(idsToHide);
    setVisibleChatSessionIdsForWorkspace(workspaceUiKey, nextVisible);
    idsToHide.forEach((id) => rememberHiddenChatSessionForWorkspace(workspaceUiKey, id));
    if (activeSessionId && hideSet.has(activeSessionId)) {
      selectSessionId(anchorSessionId, "header_tab");
    }
    return true;
  }, [
    activeSessionId,
    markErroredSessionsViewedBeforeHide,
    rememberHiddenChatSessionForWorkspace,
    selectSessionId,
    setVisibleChatSessionIdsForWorkspace,
    visibleIds,
    workspaceUiKey,
  ]);

  const restoreHiddenOrDismissedChatTab = useCallback(() => {
    if (!workspaceUiKey || !materializedWorkspaceId) {
      return false;
    }

    const hiddenId = resolveMostRecentHiddenChatTab({
      recentlyHiddenIds: recentlyHiddenChatSessionIdsByWorkspace[workspaceUiKey] ?? [],
      liveIds,
      visibleIds,
    });
    if (hiddenId) {
      return showChatSessionTab(hiddenId, { select: true });
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_restore",
      source: "workspace_tab",
      targetWorkspaceId: materializedWorkspaceId,
    });
    void restoreLastDismissedSession({ latencyFlowId }).then((restoredSessionId) => {
      if (!restoredSessionId) {
        return;
      }
      void activateChatTab({
        workspaceId: materializedWorkspaceId,
        shellWorkspaceId: workspaceUiKey,
        sessionId: restoredSessionId,
        source: "workspace_tab_restore",
        selection: {
          latencyFlowId,
          allowColdIdleNoStream: true,
        },
      }).catch((error) => {
        failLatencyFlow(latencyFlowId, "session_restore_failed");
        const message = error instanceof Error ? error.message : String(error);
        showToast(message);
      });
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "session_restore_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
    return true;
  }, [
    activateChatTab,
    liveIds,
    materializedWorkspaceId,
    recentlyHiddenChatSessionIdsByWorkspace,
    restoreLastDismissedSession,
    showChatSessionTab,
    showToast,
    visibleIds,
    workspaceUiKey,
  ]);

  return {
    showChatSessionTab,
    hideChatSessionTabs,
    closeOtherChatSessionTabs,
    closeChatSessionTabsToRight,
    restoreHiddenOrDismissedChatTab,
    selectSessionId,
  };
}
