import { useCallback, useMemo } from "react";
import { WorkspaceActions } from "#product/components/workspace/shell/topbar/WorkspaceActionsMenu";
import {
  useOptionalWorkspaceHeaderTabsViewModelContext,
} from "#product/components/workspace/shell/providers/WorkspaceHeaderTabsViewModelContext";
import { useChatTabVisibilityActions } from "#product/hooks/workspaces/workflows/tabs/use-chat-tab-visibility-actions";
import { useSessionDismissActions } from "#product/hooks/sessions/workflows/use-session-dismiss-actions";
import { useSessionForkActions } from "#product/hooks/sessions/workflows/use-session-fork-actions";
import { useManualChatGroupActions } from "#product/hooks/workspaces/workflows/tabs/use-manual-chat-group-actions";
import { runShortcutHandler } from "#product/lib/domain/shortcuts/registry";
import { useToastStore } from "#product/stores/toast/toast-store";

/**
 * Wires the workspace three-dot menu to session tab actions. Git and publish
 * entry points live in the composer workspace-activity card. Renders nothing
 * when the header tabs view model is
 * unavailable (no workspace shell).
 */
export function WorkspaceActionsMenuContainer() {
  const viewModel = useOptionalWorkspaceHeaderTabsViewModelContext();
  const showToast = useToastStore((state) => state.show);
  const { dismissSession } = useSessionDismissActions();
  const {
    removeSessions: removeSessionsFromManualChatGroups,
  } = useManualChatGroupActions();

  const chatVisibilityActions = useChatTabVisibilityActions({
    workspaceUiKey: viewModel?.workspaceUiKey,
    materializedWorkspaceId: viewModel?.materializedWorkspaceId,
    visibleIds: viewModel?.visibleChatSessionIds ?? [],
    liveIds: viewModel?.liveChatSessionIds ?? [],
    childToParent: viewModel?.childToParent ?? new Map(),
  });
  const handleSessionForked = useCallback((response: { session: { id: string } }) => {
    chatVisibilityActions.showChatSessionTab(response.session.id, { select: true });
  }, [chatVisibilityActions.showChatSessionTab]);
  const { forkSession } = useSessionForkActions({
    workspaceId: viewModel?.selectedWorkspaceId ?? null,
    onForked: handleSessionForked,
  });

  const activeTab = useMemo(
    () => viewModel?.chatTabs.find((tab) => tab.isActive) ?? null,
    [viewModel?.chatTabs],
  );
  const activeSessionId = viewModel?.activeSessionId ?? null;
  const canDismissActiveSession = activeTab !== null
    && !activeTab.isReviewAgentChild
    && chatVisibilityActions.canHideChatSessionTabs([activeTab.id]);

  const handleRename = useCallback(() => {
    runShortcutHandler("session.rename", { source: "menu" });
  }, []);
  const handleFork = useCallback(() => {
    if (activeSessionId) {
      forkSession(activeSessionId);
    }
  }, [activeSessionId, forkSession]);
  const handleDismiss = useCallback(() => {
    if (!activeSessionId || !viewModel || !canDismissActiveSession) {
      return;
    }
    const workspaceGroupKey = viewModel.workspaceUiKey ?? viewModel.selectedWorkspaceId;
    void dismissSession(activeSessionId).then(() => {
      if (workspaceGroupKey) {
        removeSessionsFromManualChatGroups(workspaceGroupKey, [activeSessionId]);
      }
    }).catch((error) => {
      showToast(error instanceof Error ? error.message : String(error));
    });
  }, [
    activeSessionId,
    canDismissActiveSession,
    dismissSession,
    removeSessionsFromManualChatGroups,
    showToast,
    viewModel,
  ]);
  if (!viewModel) {
    return null;
  }

  return (
    <WorkspaceActions
      session={{
        canRename: activeTab !== null && !activeTab.isReviewAgentChild,
        canFork: activeTab !== null
          && activeTab.canFork
          && !activeTab.isChild
          && !activeTab.isReviewAgentChild,
        canDismiss: canDismissActiveSession,
        onRename: handleRename,
        onFork: handleFork,
        onDismiss: handleDismiss,
      }}
    />
  );
}
