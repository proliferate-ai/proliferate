import { useCallback } from "react";
import { sessionSlotBelongsToWorkspace } from "@/lib/domain/sessions/activity";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import {
  clearLastViewedSession,
  clearViewedSessionErrors,
} from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/workspace-ui-key";

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
    const selectedWorkspaceId = initialState.selectedWorkspaceId;
    const selectedLogicalWorkspaceId =
      useLogicalWorkspaceStore.getState().selectedLogicalWorkspaceId;
    const cleanupUiKey = workspaceId && workspaceId === selectedWorkspaceId
      ? resolveWorkspaceUiKey(selectedLogicalWorkspaceId, selectedWorkspaceId)
      : workspaceId;

    closeSessionSlotStream(sessionId);
    removeSessionSlot(sessionId);
    clearViewedSessionErrors([sessionId]);

    if (initialState.activeSessionId === sessionId) {
      const nextActiveId = Object.values(useHarnessStore.getState().sessionSlots)
        .filter((slot) => sessionSlotBelongsToWorkspace(slot, workspaceId ?? null))
        .map((slot) => slot.sessionId)[0] ?? null;

      if (nextActiveId) {
        activateSession(nextActiveId);
      } else {
        useHarnessStore.getState().setActiveSessionId(null);
      }
    }

    if (workspaceId) {
      if (cleanupUiKey) {
        clearLastViewedSession(cleanupUiKey, sessionId);
      }
      removeWorkspaceSessionRecord(workspaceId, sessionId);
    }
  }, [activateSession, closeSessionSlotStream, removeSessionSlot, removeWorkspaceSessionRecord]);
}
