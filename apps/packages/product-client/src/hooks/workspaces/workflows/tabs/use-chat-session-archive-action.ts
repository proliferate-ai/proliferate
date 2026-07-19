import { useCallback } from "react";
import { sessionSlotBelongsToWorkspace } from "@proliferate/product-domain/sessions/activity";
import { useSessionDismissActions } from "#product/hooks/sessions/workflows/use-session-dismiss-actions";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import { useManualChatGroupActions } from "#product/hooks/workspaces/workflows/tabs/use-manual-chat-group-actions";
import { resolveVisibleChatSessionIds, uniqueIds } from "#product/lib/domain/workspaces/tabs/visibility";
import { archiveVisibleChatSession } from "#product/lib/workflows/workspaces/chat-session-archive";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";

interface ChatSessionArchiveActionInput {
  workspaceUiKey?: string | null;
  materializedWorkspaceId?: string | null;
  liveIds: string[];
  childToParent: Map<string, string>;
}

export function useChatSessionArchiveAction(input: ChatSessionArchiveActionInput) {
  const {
    childToParent,
    liveIds,
    materializedWorkspaceId,
    workspaceUiKey,
  } = input;
  const reserveChatSessionArchiveForWorkspace = useWorkspaceUiStore(
    (state) => state.reserveChatSessionArchiveForWorkspace,
  );
  const completeChatSessionArchiveForWorkspace = useWorkspaceUiStore(
    (state) => state.completeChatSessionArchiveForWorkspace,
  );
  const { dismissSession } = useSessionDismissActions();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { removeSessions: removeSessionsFromManualGroups } = useManualChatGroupActions();
  const showToast = useToastStore((state) => state.show);

  return useCallback(async (sessionId: string) => {
    if (!workspaceUiKey || !materializedWorkspaceId) {
      return false;
    }
    const liveSessions = liveIds.map((liveSessionId) => ({
      sessionId: liveSessionId,
      parentSessionId: childToParent.get(liveSessionId) ?? null,
    }));

    try {
      return await archiveVisibleChatSession(sessionId, {
        reserve: (targetSessionId) => reserveChatSessionArchiveForWorkspace({
          activeSessionId: useSessionSelectionStore.getState().activeSessionId,
          liveSessions,
          sessionId: targetSessionId,
          workspaceId: workspaceUiKey,
        }),
        completeReservation: (sessionIds) =>
          completeChatSessionArchiveForWorkspace(workspaceUiKey, sessionIds),
        dismissSession,
        getRuntimeBlockReason: () =>
          getWorkspaceRuntimeBlockReason(materializedWorkspaceId),
        notifyRuntimeBlocked: showToast,
        removeSessionsFromManualGroups: (sessionIds) =>
          removeSessionsFromManualGroups(workspaceUiKey, sessionIds),
        resolveReservedFallback: (capturedFallbackSessionId) => {
          const state = useWorkspaceUiStore.getState();
          const hasPersistedVisible = Object.prototype.hasOwnProperty.call(
            state.visibleChatSessionIdsByWorkspace,
            workspaceUiKey,
          );
          const currentVisibleIds = resolveVisibleChatSessionIds({
            activeSessionId: useSessionSelectionStore.getState().activeSessionId,
            liveSessions,
            persistedVisibleIds: hasPersistedVisible
              ? state.visibleChatSessionIdsByWorkspace[workspaceUiKey]
              : undefined,
            recentlyHiddenIds:
              state.recentlyHiddenChatSessionIdsByWorkspace[workspaceUiKey] ?? [],
          }).visibleSessionIds;
          const currentVisibleSet = new Set(currentVisibleIds);
          const candidateIds = uniqueIds([
            capturedFallbackSessionId ?? "",
            ...currentVisibleIds,
          ]);
          return candidateIds.find((candidateId) => (
            currentVisibleSet.has(candidateId)
            && sessionSlotBelongsToWorkspace(
              getSessionRecord(candidateId),
              materializedWorkspaceId,
            )
          )) ?? null;
        },
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [
    childToParent,
    completeChatSessionArchiveForWorkspace,
    dismissSession,
    getWorkspaceRuntimeBlockReason,
    liveIds,
    materializedWorkspaceId,
    removeSessionsFromManualGroups,
    reserveChatSessionArchiveForWorkspace,
    showToast,
    workspaceUiKey,
  ]);
}
