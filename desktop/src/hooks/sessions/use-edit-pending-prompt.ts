import { useCallback } from "react";
import { useEditPendingPromptMutation } from "@anyharness/sdk-react";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useEditPendingPrompt() {
  const mutation = useEditPendingPromptMutation();
  const showToast = useToastStore((state) => state.show);

  return useCallback(
    async (sessionId: string, seq: number, text: string) => {
      try {
        await mutation.mutateAsync({ sessionId, seq, text });
        const slot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
        const workspaceId = slot?.workspaceId ?? null;
        trackProductEvent("chat_pending_prompt_edited", {
          agent_kind: slot?.agentKind ?? "unknown",
          workspace_kind: workspaceId && parseCloudWorkspaceSyntheticId(workspaceId)
            ? "cloud"
            : "local",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showToast(`Failed to edit queued message: ${message}`);
        captureTelemetryException(error, {
          tags: {
            action: "edit_pending_prompt",
            domain: "chat",
          },
        });
      }
    },
    [mutation, showToast],
  );
}
