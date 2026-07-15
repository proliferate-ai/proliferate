import { useCallback } from "react";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";

export function useDeletePendingPrompt() {
  const telemetry = useProductTelemetry();
  return useCallback(
    (sessionId: string, seq: number) => {
      const slot = getSessionRecord(sessionId);
      const workspaceId = slot?.workspaceId ?? null;
      useSessionIntentStore.getState().enqueueDeletePendingPrompt({
        clientSessionId: sessionId,
        materializedSessionId: slot?.materializedSessionId ?? null,
        workspaceId,
        seq,
      });
      telemetry.track("chat_pending_prompt_deleted", {
        agent_kind: slot?.agentKind ?? "unknown",
        workspace_kind: workspaceId && parseCloudWorkspaceSyntheticId(workspaceId)
          ? "cloud"
          : "local",
      });
    },
    [telemetry],
  );
}
