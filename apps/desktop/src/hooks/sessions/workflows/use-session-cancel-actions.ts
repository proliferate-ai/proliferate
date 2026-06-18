import { useCancelSessionMutation } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import {
  getSessionClientAndWorkspace,
} from "@/lib/access/anyharness/session-runtime";
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useSessionCancelActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const cancelSessionMutation = useCancelSessionMutation();

  const cancelActiveSession = useCallback(async () => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      return;
    }

    const workspaceId = getSessionRecord(sessionId)?.workspaceId ?? state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    try {
      const { materializedSessionId, workspaceId } = await getSessionClientAndWorkspace(sessionId);
      await cancelSessionMutation.mutateAsync({ workspaceId, sessionId: materializedSessionId });
      // Don't optimistically flip to "idle": that races the authoritative
      // turn_ended event (which carries the "cancelled" stop reason and closes
      // the streaming/tool items). Let the reducer-driven state settle so the
      // "You stopped after Ns" affordance and tool teardown stay consistent.
    } catch {
      // Cancel failed.
    }
  }, [cancelSessionMutation, getWorkspaceRuntimeBlockReason, showToast]);

  return { cancelActiveSession };
}
