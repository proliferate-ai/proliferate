import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { useCallback } from "react";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { PROMPT_SUBMIT_MEASUREMENT_SURFACES } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type { PromptAttachmentSnapshot } from "@proliferate/product-domain/chats/composer/prompt-attachment-snapshot";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import {
  isPromptOutboxPlacementBusy,
  resolvePromptOutboxPlacement,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import {
  promptIntentsForSession,
} from "@proliferate/product-domain/sessions/intents/session-intent-state";
import { finishLatencyFlow } from "@/lib/infra/measurement/latency-flow";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementWorkflowStep,
} from "@/lib/infra/measurement/debug-measurement";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import { getSessionRecord, patchSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import type { SessionConfigOptionUpdateOptions } from "@/hooks/sessions/workflows/session-control-contract";
import {
  useSessionInteractionResolutionActions,
} from "@/hooks/sessions/workflows/use-session-interaction-resolution-actions";

interface SendPromptInput {
  sessionId: string;
  text: string;
  blocks?: PromptInputBlock[];
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  optimisticContentParts?: ContentPart[];
  workspaceId?: string | null;
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  promptId?: string | null;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

export function useSessionIntentActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const {
    resolvePermission,
    resolveMcpElicitation,
    resolveUserInput,
    revealMcpElicitationUrl,
  } = useSessionInteractionResolutionActions();

  const sendPrompt = useCallback(async ({
    sessionId,
    text,
    blocks,
    attachmentSnapshots,
    optimisticContentParts,
    workspaceId,
    latencyFlowId,
    measurementOperationId,
    promptId,
    onBeforeOptimisticPrompt,
  }: SendPromptInput) => {
    const slot = getSessionRecord(sessionId);
    const resolvedWorkspaceId = workspaceId ?? slot?.workspaceId ?? null;

    if (resolvedWorkspaceId && onBeforeOptimisticPrompt) {
      await onBeforeOptimisticPrompt(resolvedWorkspaceId);
    }

    const clientPromptId = promptId ?? createPromptId();
    const intentStore = useSessionIntentStore.getState();
    const existingPromptIntents = promptIntentsForSession(intentStore, sessionId);
    const enqueueStartedAt = performance.now();
    if (measurementOperationId) {
      markOperationForNextCommit(
        measurementOperationId,
        PROMPT_SUBMIT_MEASUREMENT_SURFACES,
      );
    }
    const outboxPlacement = resolvePromptOutboxPlacement({
      isSessionBusy: isPromptOutboxPlacementBusy({
        transcript: slot?.transcript,
        executionSummary: slot?.executionSummary,
        status: slot?.status,
        streamConnectionState: slot?.streamConnectionState,
      }),
      isSessionMaterialized: Boolean(slot?.materializedSessionId),
      existingEntries: existingPromptIntents,
    });
    const enqueuePrompt = () => {
      intentStore.enqueuePrompt({
        clientPromptId,
        clientSessionId: sessionId,
        materializedSessionId: slot?.materializedSessionId ?? null,
        workspaceId: resolvedWorkspaceId,
        text,
        blocks: blocks ?? [{ type: "text", text }],
        attachmentSnapshots,
        contentParts: optimisticContentParts,
        placement: outboxPlacement,
        latencyFlowId,
      });
    };
    enqueuePrompt();
    patchSessionRecord(sessionId, { hasAttemptedPrompt: true });
    logLatency("session.intent.prompt.enqueue", {
      clientPromptId,
      clientSessionId: sessionId,
      workspaceId: resolvedWorkspaceId,
      materializedSessionId: slot?.materializedSessionId ?? null,
      deliveryState: "waiting_for_session",
      placement: outboxPlacement,
      hasSlot: Boolean(slot),
      slotStatus: slot?.status ?? null,
      transcriptHydrated: slot?.transcriptHydrated ?? null,
      streamConnectionState: slot?.streamConnectionState ?? null,
      existingPromptIntentCount: existingPromptIntents.length,
      blockTypes: (blocks ?? [{ type: "text" as const, text }]).map((block) => block.type),
      attachmentCount: attachmentSnapshots?.length ?? 0,
      hasOptimisticContentParts: Boolean(optimisticContentParts?.length),
    });
    recordMeasurementWorkflowStep({
      operationId: measurementOperationId,
      step: "prompt.submit.enqueue",
      startedAt: enqueueStartedAt,
      outcome: "completed",
      count: existingPromptIntents.length + 1,
    });
    if (measurementOperationId) {
      const afterPaintStartedAt = performance.now();
      scheduleAfterNextPaint(() => {
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "prompt.submit.after_paint",
          startedAt: afterPaintStartedAt,
          outcome: "completed",
        });
        finishOrCancelMeasurementOperation(measurementOperationId, "completed");
      });
    }
    finishLatencyFlow(latencyFlowId, "optimistic_visible", {
      keepActive: true,
    });
  }, []);

  const setActiveSessionConfigOption = useCallback(async (
    configId: string,
    value: string,
    options?: SessionConfigOptionUpdateOptions,
  ) => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      throw new Error("No active session");
    }
    const slot = getSessionRecord(sessionId);
    if (!slot) {
      throw new Error("No active session");
    }
    const workspaceId = slot.workspaceId ?? state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId: sessionId,
      materializedSessionId: slot.materializedSessionId ?? null,
      workspaceId,
      configId,
      value,
      persistDefaultPreference: options?.persistDefaultPreference !== false,
    });
  }, [getWorkspaceRuntimeBlockReason]);

  return {
    promptSession: sendPrompt,
    sendPrompt,
    setActiveSessionConfigOption,
    resolvePermission,
    resolveMcpElicitation,
    resolveUserInput,
    revealMcpElicitationUrl,
  };
}
