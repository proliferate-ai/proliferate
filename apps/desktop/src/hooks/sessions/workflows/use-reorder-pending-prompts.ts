import { useCallback } from "react";
import { useReorderPendingPromptsMutation } from "@anyharness/sdk-react";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { getMaterializedSessionId, getSessionRecord } from "@/stores/sessions/session-records";

export function useReorderPendingPrompts() {
  const mutation = useReorderPendingPromptsMutation();

  return useCallback(
    async (sessionId: string, seqs: number[]) => {
      const materializedSessionId = getMaterializedSessionId(sessionId);
      if (!materializedSessionId) {
        return;
      }
      const slot = getSessionRecord(sessionId);
      const workspaceId = slot?.workspaceId ?? null;
      await mutation.mutateAsync({ sessionId: materializedSessionId, seqs });
      trackProductEvent("chat_pending_prompts_reordered", {
        agent_kind: slot?.agentKind ?? "unknown",
        workspace_kind: workspaceId && parseCloudWorkspaceSyntheticId(workspaceId)
          ? "cloud"
          : "local",
        count: seqs.length,
      });
    },
    [mutation],
  );
}
