import { useCallback } from "react";
import { useEditPendingPromptMutation } from "@anyharness/sdk-react";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useToastStore } from "@/stores/toast/toast-store";

export function useEditPendingPrompt() {
  const mutation = useEditPendingPromptMutation();
  const showToast = useToastStore((state) => state.show);

  return useCallback(
    async (sessionId: string, seq: number, text: string) => {
      try {
        await mutation.mutateAsync({ sessionId, seq, text });
        const slot = getSessionRecord(sessionId);
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
