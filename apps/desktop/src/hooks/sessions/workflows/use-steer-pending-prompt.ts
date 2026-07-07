import { useCallback } from "react";
import { useSteerPendingPromptMutation } from "@anyharness/sdk-react";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { getMaterializedSessionId, getSessionRecord } from "@/stores/sessions/session-records";

export function useSteerPendingPrompt() {
  const mutation = useSteerPendingPromptMutation();

  return useCallback(
    async (sessionId: string, seq: number) => {
      const materializedSessionId = getMaterializedSessionId(sessionId);
      if (!materializedSessionId) {
        return;
      }
      const slot = getSessionRecord(sessionId);
      const workspaceId = slot?.workspaceId ?? null;
      await mutation.mutateAsync({ sessionId: materializedSessionId, seq });
      trackProductEvent("chat_pending_prompt_steered", {
        agent_kind: slot?.agentKind ?? "unknown",
        workspace_kind: workspaceId && parseCloudWorkspaceSyntheticId(workspaceId)
          ? "cloud"
          : "local",
      });
    },
    [mutation],
  );
}
