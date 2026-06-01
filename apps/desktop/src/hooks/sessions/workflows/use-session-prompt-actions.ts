import { useCallback } from "react";
import { useSessionPromptWorkflow } from "@/hooks/sessions/workflows/use-session-prompt-workflow";
import type { ActiveSessionPromptOptions } from "@/hooks/sessions/workflows/session-control-contract";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import {
  getSessionRecord,
  isPendingSessionId,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { canPromptSessionSlot } from "@/lib/domain/sessions/prompt-readiness";

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
    const sessionIsPending = isPendingSessionId(sessionId);
    if (!sessionIsPending && !slot) {
      logLatency("session.prompt.active.blocked", {
        reason: "missing_slot",
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
      });
      throw new Error("No active session");
    }
    if (sessionIsPending && !slot) {
      logLatency("session.prompt.active.blocked", {
        reason: "unmaterialized_session",
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
      });
      throw new Error("Session is still starting. Try again in a moment.");
    }
    if (slot && !slot.materializedSessionId) {
      logLatency("session.prompt.active.blocked", {
        reason: "unmaterialized_session",
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
        slotWorkspaceId: slot.workspaceId,
        status: slot.status,
        streamConnectionState: slot.streamConnectionState,
        transcriptHydrated: slot.transcriptHydrated,
      });
      throw new Error("Session is still starting. Try again in a moment.");
    }
    if (!sessionIsPending && slot && !canPromptSessionSlot(slot)) {
      logLatency("session.prompt.active.blocked", {
        reason: "transcript_not_hydrated",
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
        slotWorkspaceId: slot.workspaceId,
        materializedSessionId: slot.materializedSessionId,
        status: slot.status,
        streamConnectionState: slot.streamConnectionState,
        transcriptLastSeq: slot.transcript.lastSeq,
        turnCount: slot.transcript.turnOrder.length,
        pendingInteractionCount: slot.transcript.pendingInteractions.length,
      });
      throw new Error("Session is still loading. Try again in a moment.");
    }
    if (!sessionIsPending && slot && !slot.transcriptHydrated) {
      logLatency("session.prompt.active.unhydrated_open_stream_allowed", {
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
        slotWorkspaceId: slot.workspaceId,
        materializedSessionId: slot.materializedSessionId,
        status: slot.status,
        streamConnectionState: slot.streamConnectionState,
        transcriptLastSeq: slot.transcript.lastSeq,
        turnCount: slot.transcript.turnOrder.length,
        pendingInteractionCount: slot.transcript.pendingInteractions.length,
      });
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
