import { useCallback } from "react";
import { sessionSlotBelongsToWorkspace } from "@/lib/domain/sessions/activity";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import {
  clearLastViewedSession,
  clearViewedSessionErrors,
} from "@/stores/preferences/workspace-ui-store";
import {
  resolveWithWorkspaceFallback,
} from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { resolveWorkspaceShellStateKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  getSessionRecord,
  getWorkspaceSessionRecords,
  removeSessionRecord,
} from "@/stores/sessions/session-records";
import { invalidateSessionActivationIntent } from "@/hooks/sessions/session-activation-guard";
import {
  writeChatShellIntentForEmptySurface,
  writeChatShellIntentForSession,
} from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import { chatWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useDismissedSessionCleanup() {
  const { activateSession, closeSessionSlotStream } = useSessionRuntimeActions();
  const { removeWorkspaceSessionRecord } = useWorkspaceSessionCache();

  return useCallback((sessionId: string, workspaceIdHint?: string | null) => {
    const selection = useSessionSelectionStore.getState();
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
    const shouldUpdateShellIntent = previousShellIntent === null
      || previousShellIntent === chatWorkspaceShellTabKey(sessionId);

    closeSessionSlotStream(sessionId);
    removeSessionRecord(sessionId);
    clearViewedSessionErrors([sessionId]);

    if (selection.activeSessionId === sessionId) {
      const nextActiveId = Object.values(getWorkspaceSessionRecords(workspaceId))
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
