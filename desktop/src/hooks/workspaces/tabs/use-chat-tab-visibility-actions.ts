import { useCallback } from "react";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import {
  collectGroupIds,
  resolveFallbackAfterHidingChatTabs,
  resolveMostRecentHiddenChatTab,
  uniqueIds,
} from "@/lib/domain/workspaces/tabs/visibility";
import { resolveSessionErrorAttentionKey } from "@/lib/domain/sessions/activity";
import { chatWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";

interface ChatTabVisibilityContext {
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
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const setActiveSessionId = useHarnessStore((state) => state.setActiveSessionId);
  const setActiveShellTabKey = useWorkspaceUiStore(
    (state) => state.setActiveShellTabKeyForWorkspace,
  );
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
  const { restoreLastDismissedSession, selectSession } = useSessionActions();

  const selectSessionId = useCallback((sessionId: string, source: string) => {
    if (!workspaceUiKey) {
      return;
    }
    setActiveShellTabKey(workspaceUiKey, chatWorkspaceShellTabKey(sessionId));
    const latencyFlowId = startLatencyFlow({
      flowKind: "session_switch",
      source,
      targetWorkspaceId: materializedWorkspaceId,
      targetSessionId: sessionId,
    });
    void selectSession(sessionId, { latencyFlowId }).catch((error) => {
      failLatencyFlow(latencyFlowId, "session_switch_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [materializedWorkspaceId, selectSession, setActiveShellTabKey, showToast, workspaceUiKey]);

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

    const parentId = context.childToParent.get(sessionId);
    const idsToShow = parentId ? [parentId, sessionId] : [sessionId];
    const nextVisible = uniqueIds([...context.visibleIds, ...idsToShow]);
    setVisibleChatSessionIdsForWorkspace(workspaceUiKey, nextVisible);
    clearHiddenChatSessionsForWorkspace(workspaceUiKey, idsToShow);
    if (options?.select) {
      selectSessionId(sessionId, "header_tab");
    }
    return true;
  }, [
    clearHiddenChatSessionsForWorkspace,
    context.childToParent,
    context.visibleIds,
    selectSessionId,
    setVisibleChatSessionIdsForWorkspace,
    workspaceUiKey,
  ]);

  const hideChatSessionTabs = useCallback((sessionIds: string[], options?: HideOptions) => {
    if (!workspaceUiKey) {
      return false;
    }

    const expandedHideSet = new Set(sessionIds);
    for (const sessionId of sessionIds) {
      if (!context.childToParent.has(sessionId)) {
        for (const [childId, parentId] of context.childToParent) {
          if (parentId === sessionId) {
            expandedHideSet.add(childId);
          }
        }
      }
    }
    const idsToHide = [...expandedHideSet];
    const nextVisible = context.visibleIds.filter((id) => !expandedHideSet.has(id));
    markErroredSessionsViewedBeforeHide(idsToHide);
    setVisibleChatSessionIdsForWorkspace(workspaceUiKey, nextVisible);
    idsToHide.forEach((id) => rememberHiddenChatSessionForWorkspace(workspaceUiKey, id));

    if (options?.selectFallback) {
      const fallbackId = resolveFallbackAfterHidingChatTabs({
        visibleIdsBeforeHide: context.visibleIds,
        idsToHide,
        activeSessionId,
      });
      if (fallbackId) {
        selectSessionId(fallbackId, "header_tab");
      } else if (activeSessionId && expandedHideSet.has(activeSessionId)) {
        setActiveSessionId(null);
        setActiveShellTabKey(workspaceUiKey, null);
      }
    }

    return true;
  }, [
    activeSessionId,
    context.childToParent,
    context.visibleIds,
    markErroredSessionsViewedBeforeHide,
    rememberHiddenChatSessionForWorkspace,
    selectSessionId,
    setActiveSessionId,
    setActiveShellTabKey,
    setVisibleChatSessionIdsForWorkspace,
    workspaceUiKey,
  ]);

  const closeOtherChatSessionTabs = useCallback((anchorSessionId: string) => {
    if (!workspaceUiKey) {
      return false;
    }

    const parentId = context.childToParent.get(anchorSessionId);
    const rootId = parentId ?? anchorSessionId;
    const keepIds = parentId
      ? [parentId, anchorSessionId]
      : collectGroupIds({
        rootSessionId: rootId,
        visibleIds: context.visibleIds,
        childToParent: context.childToParent,
      });
    const keepSet = new Set(keepIds);
    const idsToHide = context.visibleIds.filter((id) => !keepSet.has(id));
    markErroredSessionsViewedBeforeHide(idsToHide);
    setVisibleChatSessionIdsForWorkspace(workspaceUiKey, keepIds);
    idsToHide.forEach((id) => rememberHiddenChatSessionForWorkspace(workspaceUiKey, id));
    if (activeSessionId && !keepSet.has(activeSessionId)) {
      selectSessionId(anchorSessionId, "header_tab");
    }
    return true;
  }, [
    activeSessionId,
    context.childToParent,
    context.visibleIds,
    markErroredSessionsViewedBeforeHide,
    rememberHiddenChatSessionForWorkspace,
    selectSessionId,
    setVisibleChatSessionIdsForWorkspace,
    workspaceUiKey,
  ]);

  const closeChatSessionTabsToRight = useCallback((anchorSessionId: string) => {
    if (!workspaceUiKey) {
      return false;
    }

    const anchorIndex = context.visibleIds.indexOf(anchorSessionId);
    if (anchorIndex === -1) {
      return false;
    }

    const idsToHide = context.visibleIds.slice(anchorIndex + 1);
    const hideSet = new Set(idsToHide);
    const nextVisible = context.visibleIds.filter((id) => !hideSet.has(id));
    markErroredSessionsViewedBeforeHide(idsToHide);
    setVisibleChatSessionIdsForWorkspace(workspaceUiKey, nextVisible);
    idsToHide.forEach((id) => rememberHiddenChatSessionForWorkspace(workspaceUiKey, id));
    if (activeSessionId && hideSet.has(activeSessionId)) {
      selectSessionId(anchorSessionId, "header_tab");
    }
    return true;
  }, [
    activeSessionId,
    context.visibleIds,
    markErroredSessionsViewedBeforeHide,
    rememberHiddenChatSessionForWorkspace,
    selectSessionId,
    setVisibleChatSessionIdsForWorkspace,
    workspaceUiKey,
  ]);

  const restoreHiddenOrDismissedChatTab = useCallback(() => {
    if (!workspaceUiKey) {
      return false;
    }

    const hiddenId = resolveMostRecentHiddenChatTab({
      recentlyHiddenIds: recentlyHiddenChatSessionIdsByWorkspace[workspaceUiKey] ?? [],
      liveIds: context.liveIds,
      visibleIds: context.visibleIds,
    });
    if (hiddenId) {
      return showChatSessionTab(hiddenId, { select: true });
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_restore",
      source: "workspace_tab",
      targetWorkspaceId: materializedWorkspaceId,
    });
    void restoreLastDismissedSession({ latencyFlowId }).catch((error) => {
      failLatencyFlow(latencyFlowId, "session_restore_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
    return true;
  }, [
    context.liveIds,
    context.visibleIds,
    recentlyHiddenChatSessionIdsByWorkspace,
    restoreLastDismissedSession,
    materializedWorkspaceId,
    showChatSessionTab,
    showToast,
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
