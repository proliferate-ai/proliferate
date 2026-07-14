import { useCallback } from "react";
import { useReorderPendingPromptsMutation } from "@anyharness/sdk-react";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { getMaterializedSessionId, getSessionRecord } from "@/stores/sessions/session-records";

export function useReorderPendingPrompts() {
  const mutation = useReorderPendingPromptsMutation();
  const telemetry = useProductTelemetry();

  return useCallback(
    async (sessionId: string, expectedSeqs: number[], desiredSeqs: number[]) => {
      const materializedSessionId = getMaterializedSessionId(sessionId);
      if (!materializedSessionId) {
        return;
      }
      const slot = getSessionRecord(sessionId);
      const workspaceId = slot?.workspaceId ?? null;
      await mutation.mutateAsync({
        sessionId: materializedSessionId,
        expectedSeqs,
        desiredSeqs,
      });
      telemetry.track("chat_pending_prompts_reordered", {
        agent_kind: slot?.agentKind ?? "unknown",
        workspace_kind: workspaceId && parseCloudWorkspaceSyntheticId(workspaceId)
          ? "cloud"
          : "local",
        count: desiredSeqs.length,
      });
    },
    [mutation, telemetry],
  );
}
