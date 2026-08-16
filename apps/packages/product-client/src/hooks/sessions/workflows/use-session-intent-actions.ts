import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { useCallback } from "react";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { PROMPT_SUBMIT_MEASUREMENT_SURFACES } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import type { PromptAttachmentSnapshot } from "#product/domain/chats/composer/prompt-attachment-snapshot";
import { createPromptId } from "#product/lib/domain/chat/composer/prompt-id";
import {
  isPromptOutboxPlacementBusy,
  resolvePromptOutboxPlacement,
} from "#product/domain/sessions/intents/session-intent-selectors";
import {
  promptIntentsForSession,
} from "#product/domain/sessions/intents/session-intent-state";
import { finishLatencyFlow } from "#product/lib/infra/measurement/measurement-port";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementWorkflowStep,
} from "#product/lib/infra/measurement/measurement-port";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import { scheduleAfterNextPaint } from "#product/lib/infra/scheduling/schedule-after-next-paint";
import { promptFallbackTitle } from "#product/lib/domain/sessions/title";
import { getSessionRecord, patchSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import type { SessionConfigOptionUpdateOptions } from "#product/hooks/sessions/workflows/session-control-contract";
import {
  useSessionInteractionResolutionActions,
} from "#product/hooks/sessions/workflows/use-session-interaction-resolution-actions";
import { beginRendererFlow } from "#product/lib/infra/diagnostics/renderer-flow-timing";

export interface SendPromptInput {
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
    // First prompt into an untitled session: show the prompt text as the tab
    // title from this very frame. The runtime persists the same fallback on
    // acceptance and the generated summary replaces it once available.
    const optimisticTitle = promptFallbackTitle(text);
    const shouldTitleFromPrompt =
      Boolean(optimisticTitle) && !slot?.title?.trim() && !slot?.lastPromptAt;
    patchSessionRecord(sessionId, {
      hasAttemptedPrompt: true,
      ...(shouldTitleFromPrompt ? { title: optimisticTitle } : {}),
    });
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
    const intent = useSessionIntentStore.getState().enqueueConfig({
      clientSessionId: sessionId,
      materializedSessionId: slot.materializedSessionId ?? null,
      workspaceId,
      configId,
      value,
      persistDefaultPreference: options?.persistDefaultPreference !== false,
    });
    if (configId === "mode") {
      // UX-latency R12: keyed by intentId, which enqueueConfig keeps stable
      // across PRO-261 tail coalescing (a burst of switches reuses the same
      // queued intent), so re-begin here restarts the clock to the latest
      // input, matching the coalesced value that actually gets dispatched.
      beginRendererFlow({
        kind: "mode_switch",
        correlationKey: intent.intentId,
        correlation: { sessionId, requestId: intent.intentId },
      });
    }
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
