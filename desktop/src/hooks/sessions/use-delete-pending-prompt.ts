import { useCallback } from "react";
import { useDeletePendingPromptMutation } from "@anyharness/sdk-react";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useDeletePendingPrompt() {
  const mutation = useDeletePendingPromptMutation();
  const showToast = useToastStore((state) => state.show);

  return useCallback(
    async (sessionId: string, seq: number) => {
      try {
        await mutation.mutateAsync({ sessionId, seq });
        const slot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
        const workspaceId = slot?.workspaceId ?? null;
        trackProductEvent("chat_pending_prompt_deleted", {
          agent_kind: slot?.agentKind ?? "unknown",
          workspace_kind: workspaceId && parseCloudWorkspaceSyntheticId(workspaceId)
            ? "cloud"
            : "local",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showToast(`Failed to delete queued message: ${message}`);
        captureTelemetryException(error, {
          tags: {
            action: "delete_pending_prompt",
            domain: "chat",
          },
        });
      }
    },
    [mutation, showToast],
  );
}
