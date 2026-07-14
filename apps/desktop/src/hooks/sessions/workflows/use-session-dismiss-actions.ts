import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useDismissSessionMutation } from "@anyharness/sdk-react";
import { useDismissedSessionCleanup } from "@/hooks/sessions/workflows/use-dismissed-session-cleanup";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { getSessionClientAndWorkspace } from "@/lib/access/anyharness/session-runtime";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useSessionDismissActions() {
  const ssh = useProductHost().desktop?.ssh ?? null;
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const cleanupDismissedSession = useDismissedSessionCleanup();
  const dismissSessionMutation = useDismissSessionMutation();

  const dismissSession = useCallback(async (sessionId: string) => {
    const state = useSessionSelectionStore.getState();
    const closingSlot = getSessionRecord(sessionId);
    const workspaceId = closingSlot?.workspaceId ?? state.selectedWorkspaceId;

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    try {
      const { materializedSessionId, workspaceId: resolvedWorkspaceId } =
        await getSessionClientAndWorkspace(sessionId, ssh);
      await dismissSessionMutation.mutateAsync({
        workspaceId: resolvedWorkspaceId,
        sessionId: materializedSessionId,
      });
    } catch {
      // Dismiss failed.
    }

    cleanupDismissedSession(sessionId, workspaceId);
  }, [
    cleanupDismissedSession,
    dismissSessionMutation,
    getWorkspaceRuntimeBlockReason,
    showToast,
    ssh,
  ]);

  return { dismissSession };
}
