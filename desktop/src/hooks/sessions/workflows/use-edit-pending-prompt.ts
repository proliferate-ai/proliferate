import { useCallback } from "react";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

export function useEditPendingPrompt() {
  return useCallback(
    (sessionId: string, seq: number, text: string) => {
      const slot = getSessionRecord(sessionId);
      const workspaceId = slot?.workspaceId ?? null;
      useSessionIntentStore.getState().enqueueEditPendingPrompt({
        clientSessionId: sessionId,
        materializedSessionId: slot?.materializedSessionId ?? null,
        workspaceId,
        seq,
        text,
      });
      trackProductEvent("chat_pending_prompt_edited", {
        agent_kind: slot?.agentKind ?? "unknown",
        workspace_kind: workspaceId && parseCloudWorkspaceSyntheticId(workspaceId)
          ? "cloud"
          : "local",
      });
    },
    [],
  );
}
