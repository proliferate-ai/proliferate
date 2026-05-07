import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { useCallback } from "react";
import { flushSync } from "react-dom";
import {
  finishLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementWorkflowStep,
  type MeasurementOperationId,
} from "@/lib/infra/measurement/debug-measurement";
import { PROMPT_SUBMIT_MEASUREMENT_SURFACES } from "@/lib/infra/measurement/prompt-submit-measurement";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import {
  outboxEntriesForSession,
  resolvePromptOutboxPlacement,
} from "@/lib/domain/chat/outbox/prompt-outbox";
import type { PromptAttachmentSnapshot } from "@/lib/domain/chat/composer/prompt-attachment-snapshot";
import { isSessionSlotBusy } from "@/lib/domain/sessions/activity";
import { usePromptOutboxStore } from "@/stores/chat/prompt-outbox-store";

interface PromptSessionInput {
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

export function useSessionPromptWorkflow() {
  const promptSession = useCallback(async ({
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
  }: PromptSessionInput) => {
    const slot = getSessionRecord(sessionId);
    const resolvedWorkspaceId = workspaceId ?? slot?.workspaceId ?? null;

    if (resolvedWorkspaceId && onBeforeOptimisticPrompt) {
      await onBeforeOptimisticPrompt(resolvedWorkspaceId);
    }

    const clientPromptId = promptId ?? createPromptId();
    const outboxStore = usePromptOutboxStore.getState();
    const existingOutboxEntries = outboxEntriesForSession(outboxStore, sessionId);
    const enqueueStartedAt = performance.now();
    if (measurementOperationId) {
      markOperationForNextCommit(
        measurementOperationId,
        PROMPT_SUBMIT_MEASUREMENT_SURFACES,
      );
    }
    flushSync(() => {
      outboxStore.enqueue({
        clientPromptId,
        clientSessionId: sessionId,
        materializedSessionId: slot?.materializedSessionId ?? null,
        workspaceId: resolvedWorkspaceId,
        text,
        blocks: blocks ?? [{ type: "text", text }],
        attachmentSnapshots,
        contentParts: optimisticContentParts,
        placement: resolvePromptOutboxPlacement({
          isSessionBusy: isSessionSlotBusy(slot),
          isSessionMaterialized: Boolean(slot?.materializedSessionId),
          existingEntries: existingOutboxEntries,
        }),
        latencyFlowId,
      });
    });
    recordMeasurementWorkflowStep({
      operationId: measurementOperationId,
      step: "prompt.submit.enqueue",
      startedAt: enqueueStartedAt,
      outcome: "completed",
      count: existingOutboxEntries.length + 1,
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

  return {
    promptSession,
  };
}
