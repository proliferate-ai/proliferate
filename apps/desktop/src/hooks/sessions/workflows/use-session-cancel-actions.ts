import { useCancelSessionMutation } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import {
  getSessionClientAndWorkspace,
} from "@/lib/access/anyharness/session-runtime";
import {
  getSessionRecord,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useSessionCancelActions() {
  const host = useProductHost();
  const ssh = host.desktop?.ssh ?? null;
  const cloudClient = host.cloud.client;
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
      const { materializedSessionId, workspaceId } = await getSessionClientAndWorkspace(
        sessionId,
        ssh,
        cloudClient,
      );
      await cancelSessionMutation.mutateAsync({ workspaceId, sessionId: materializedSessionId });
      patchSessionRecord(sessionId, { status: "idle" });
    } catch {
      // Cancel failed.
    }
  }, [cancelSessionMutation, getWorkspaceRuntimeBlockReason, showToast, ssh, cloudClient]);

  return { cancelActiveSession };
}
