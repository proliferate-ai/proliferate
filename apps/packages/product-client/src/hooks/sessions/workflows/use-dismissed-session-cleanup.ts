import { useCallback } from "react";
import { sessionSlotBelongsToWorkspace } from "@proliferate/product-domain/sessions/activity";
import { useWorkspaceSessionCache } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useSessionRuntimeActions } from "#product/hooks/sessions/workflows/use-session-runtime-actions";
import {
  clearLastViewedSession,
  clearViewedSessionErrors,
} from "#product/stores/preferences/workspace-ui-store";
import {
  resolveWithWorkspaceFallback,
} from "#product/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { resolveWorkspaceShellStateKey } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import {
  getSessionRecord,
  getWorkspaceSessionRecords,
  removeSessionRecord,
} from "#product/stores/sessions/session-records";
import { invalidateSessionActivationIntent } from "#product/hooks/sessions/workflows/session-activation-guard";
import {
  writeChatShellIntentForEmptySurface,
  writeChatShellIntentForSession,
} from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import { chatWorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import type {
  VisibleChatSessionDismissOptions,
} from "#product/lib/workflows/workspaces/chat-session-archive";

export function useDismissedSessionCleanup() {
  const { activateSession, closeSessionSlotStream } = useSessionRuntimeActions();
  const { removeWorkspaceSessionRecord } = useWorkspaceSessionCache();

  return useCallback((
    sessionId: string,
    workspaceIdHint?: string | null,
    options?: VisibleChatSessionDismissOptions,
  ) => {
    const selection = useSessionSelectionStore.getState();
    const activeSessionId = selection.activeSessionId;
    const closingSlot = getSessionRecord(sessionId);
    const workspaceId = closingSlot?.workspaceId
      ?? workspaceIdHint
      ?? selection.selectedWorkspaceId;
    const shellWorkspaceId = workspaceId
      ? resolveWorkspaceShellStateKey({
        workspaceId,
        selectedWorkspaceId: selection.selectedWorkspaceId,
        selectedLogicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
      })
      : null;
    const shellState = useWorkspaceUiStore.getState();
    const previousShellIntent = workspaceId
      ? resolveWithWorkspaceFallback(
        shellState.activeShellTabKeyByWorkspace,
        shellWorkspaceId,
        workspaceId,
      ).value ?? null
      : null;
    const replacesActiveSession = activeSessionId !== null
      && (
        activeSessionId === sessionId
        || options?.replacedActiveSessionIds.includes(activeSessionId)
      );
    const shouldUpdateShellIntent = previousShellIntent === null
      || previousShellIntent === chatWorkspaceShellTabKey(sessionId)
      || (
        activeSessionId !== null
        && replacesActiveSession
        && previousShellIntent === chatWorkspaceShellTabKey(activeSessionId)
      );

    closeSessionSlotStream(sessionId);
    removeSessionRecord(sessionId);
    clearViewedSessionErrors([sessionId]);

    if (replacesActiveSession) {
      const nextActiveId = options?.resolveNextActiveSessionId
        ? options.resolveNextActiveSessionId()
        : Object.values(getWorkspaceSessionRecords(workspaceId))
          .filter((slot) => sessionSlotBelongsToWorkspace(slot, workspaceId ?? null))
          .map((slot) => slot.sessionId)[0] ?? null;

      if (nextActiveId) {
        activateSession(nextActiveId);
        if (shouldUpdateShellIntent) {
          writeChatShellIntentForSession({
            workspaceId,
            shellWorkspaceId,
            sessionId: nextActiveId,
          });
        } else if (workspaceId) {
          invalidateSessionActivationIntent(workspaceId);
        }
      } else {
        useSessionSelectionStore.getState().setActiveSessionId(null);
        if (shouldUpdateShellIntent) {
          writeChatShellIntentForEmptySurface({
            workspaceId,
            shellWorkspaceId,
          });
        } else if (workspaceId) {
          invalidateSessionActivationIntent(workspaceId);
        }
      }
    }

    if (workspaceId) {
      clearLastViewedSession(workspaceId, sessionId);
      if (shellWorkspaceId && shellWorkspaceId !== workspaceId) {
        clearLastViewedSession(shellWorkspaceId, sessionId);
      }
      removeWorkspaceSessionRecord(workspaceId, sessionId);
    }
  }, [activateSession, closeSessionSlotStream, removeWorkspaceSessionRecord]);
}
