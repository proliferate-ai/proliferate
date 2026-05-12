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
} from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { PROMPT_SUBMIT_MEASUREMENT_SURFACES } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import { resolvePromptOutboxPlacement } from "@/lib/domain/chat/outbox/prompt-outbox-selectors";
import { outboxEntriesForSession } from "@/lib/domain/chat/outbox/prompt-outbox-state";
import type { PromptAttachmentSnapshot } from "@/lib/domain/chat/composer/prompt-attachment-snapshot";
import { isSessionSlotBusy } from "@/lib/domain/sessions/activity";
import { usePromptOutboxStore } from "@/stores/chat/prompt-outbox-store";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { isProliferatePerfFlagEnabled } from "@/lib/infra/perf/perf-isolation-flags";

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
    if (isProliferatePerfFlagEnabled("pausePromptOutboxUi")) {
      logLatency("prompt.outbox.enqueue.paused_by_perf_flag", {
        clientPromptId,
        clientSessionId: sessionId,
        workspaceId: resolvedWorkspaceId,
      });
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "prompt.submit.enqueue",
        startedAt: enqueueStartedAt,
        outcome: "skipped",
        count: existingOutboxEntries.length,
      });
      finishLatencyFlow(latencyFlowId, "optimistic_visible", {
        keepActive: true,
      });
      return;
    }
    if (measurementOperationId) {
      markOperationForNextCommit(
        measurementOperationId,
        PROMPT_SUBMIT_MEASUREMENT_SURFACES,
      );
    }
    const outboxPlacement = resolvePromptOutboxPlacement({
      isSessionBusy: isSessionSlotBusy(slot),
      isSessionMaterialized: Boolean(slot?.materializedSessionId),
      existingEntries: existingOutboxEntries,
    });
    const enqueuePrompt = () => {
      outboxStore.enqueue({
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
    if (isProliferatePerfFlagEnabled("disablePromptFlushSync")) {
      enqueuePrompt();
    } else {
      flushSync(enqueuePrompt);
    }
    logLatency("prompt.outbox.enqueue", {
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
      existingOutboxEntryCount: existingOutboxEntries.length,
      blockTypes: (blocks ?? [{ type: "text" as const, text }]).map((block) => block.type),
      attachmentCount: attachmentSnapshots?.length ?? 0,
      hasOptimisticContentParts: Boolean(optimisticContentParts?.length),
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
