import { useCallback } from "react";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import type { ActiveSessionPromptOptions } from "@/hooks/sessions/workflows/session-control-contract";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  isPendingSessionId,
} from "@/lib/workflows/sessions/session-runtime";

export function useSessionPromptActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { promptSession } = useSessionPromptWorkflow();

  const promptActiveSession = useCallback(async (
    text: string,
    options?: ActiveSessionPromptOptions,
  ) => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      throw new Error("No active session");
    }

    const slot = getSessionRecord(sessionId);
    if (!isPendingSessionId(sessionId) && !slot) {
      throw new Error("No active session");
    }
    if (!isPendingSessionId(sessionId) && slot && !slot.transcriptHydrated) {
      throw new Error("Session is still loading. Try again in a moment.");
    }

    const workspaceId = slot?.workspaceId ?? null;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    await promptSession({
      sessionId,
      text,
      blocks: options?.blocks,
      attachmentSnapshots: options?.attachmentSnapshots,
      optimisticContentParts: options?.optimisticContentParts,
      workspaceId,
      latencyFlowId: options?.latencyFlowId,
      measurementOperationId: options?.measurementOperationId,
      promptId: options?.promptId,
    });
  }, [getWorkspaceRuntimeBlockReason, promptSession]);

  return { promptActiveSession };
}
