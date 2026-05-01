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
} from "@/lib/domain/workspaces/workspace-keyed-preferences";
import { resolveWorkspaceShellStateKey } from "@/lib/domain/workspaces/workspace-ui-key";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
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
  const removeSessionSlot = useHarnessStore((state) => state.removeSessionSlot);

  return useCallback((sessionId: string, workspaceIdHint?: string | null) => {
    const initialState = useHarnessStore.getState();
    const closingSlot = initialState.sessionSlots[sessionId] ?? null;
    const workspaceId = closingSlot?.workspaceId
      ?? workspaceIdHint
      ?? initialState.selectedWorkspaceId;
    const shellWorkspaceId = workspaceId
      ? resolveWorkspaceShellStateKey({
        workspaceId,
        selectedWorkspaceId: initialState.selectedWorkspaceId,
        selectedLogicalWorkspaceId: useLogicalWorkspaceStore.getState().selectedLogicalWorkspaceId,
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
    removeSessionSlot(sessionId);
    clearViewedSessionErrors([sessionId]);

    if (initialState.activeSessionId === sessionId) {
      const nextActiveId = Object.values(useHarnessStore.getState().sessionSlots)
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
        useHarnessStore.getState().setActiveSessionId(null);
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
  }, [activateSession, closeSessionSlotStream, removeSessionSlot, removeWorkspaceSessionRecord]);
}
