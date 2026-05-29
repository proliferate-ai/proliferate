import type { ContentPart, PromptInputBlock, ResolveInteractionRequest } from "@anyharness/sdk";
import {
  type McpElicitationUrlRevealResponse,
  selectPendingApprovalInteraction,
  selectPendingMcpElicitationInteraction,
  selectPendingUserInputInteraction,
  type McpElicitationSubmittedField,
  type UserInputSubmittedAnswer,
} from "@anyharness/sdk";
import { useRevealMcpElicitationUrlMutation } from "@anyharness/sdk-react";
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
  sessionIntentsForSession,
} from "@proliferate/product-domain/sessions/intents/session-intent-state";
import {
  finishLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementWorkflowStep,
} from "@/lib/infra/measurement/debug-measurement";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import type { SessionConfigOptionUpdateOptions } from "@/hooks/sessions/workflows/session-control-contract";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import {
  getSessionClientAndWorkspace,
} from "@/lib/workflows/sessions/session-runtime";

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

type InteractionAction = "permission" | "user_input" | "mcp_elicitation";

export function useSessionIntentActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const revealMcpElicitationUrlMutation = useRevealMcpElicitationUrlMutation();

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

  const enqueueResolveInteraction = useCallback((input: {
    action: InteractionAction;
    sessionId: string;
    selectedWorkspaceId: string | null;
    slot: SessionRuntimeRecord | null;
    requestId: string;
    request: ResolveInteractionRequest;
    requestExtra?: Record<string, unknown>;
  }) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(input.slot?.workspaceId ?? input.selectedWorkspaceId);
    if (blockedReason) {
      logInteractionDebug("resolve.blocked", {
        ...input,
        extra: { blockedReason },
      });
      throw new Error(blockedReason);
    }
    const existingIntent = sessionIntentsForSession(
      useSessionIntentStore.getState(),
      input.sessionId,
    ).find((intent) =>
      intent.kind === "resolve_interaction"
      && intent.requestId === input.requestId
      && (
        intent.status === "queued"
        || intent.status === "preparing"
        || intent.status === "dispatching"
        || intent.status === "accepted"
      )
    );
    if (existingIntent) {
      return;
    }
    useSessionIntentStore.getState().enqueueInteraction({
      clientSessionId: input.sessionId,
      materializedSessionId: input.slot?.materializedSessionId ?? null,
      workspaceId: input.slot?.workspaceId ?? input.selectedWorkspaceId,
      action: input.action,
      requestId: input.requestId,
      request: input.request,
      requestExtra: input.requestExtra ?? null,
    });
    logInteractionDebug("resolve.enqueued", input);
  }, [getWorkspaceRuntimeBlockReason]);

  const resolvePermission = useCallback(async (
    input: { decision?: "allow" | "deny"; optionId?: string },
  ) => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? getSessionRecord(sessionId) : null;
    const permission = slot?.transcript
      ? selectPendingApprovalInteraction(slot.transcript)
      : null;
    if (!sessionId || !permission) {
      logInteractionDebug("resolve.skipped_no_pending", {
        action: "permission",
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
        slot,
      });
      return;
    }

    const request: ResolveInteractionRequest = input.optionId
      ? { outcome: "selected", optionId: input.optionId }
      : { outcome: "decision", decision: input.decision ?? "deny" };
    enqueueResolveInteraction({
      action: "permission",
      sessionId,
      selectedWorkspaceId: state.selectedWorkspaceId,
      slot,
      requestId: permission.requestId,
      request,
      requestExtra: {
        outcome: input.optionId ? "selected" : "decision",
        hasOptionId: Boolean(input.optionId),
        decision: input.optionId ? null : input.decision ?? "deny",
      },
    });
  }, [enqueueResolveInteraction]);

  const resolveUserInput = useCallback(async (
    input:
      | { outcome: "submitted"; answers: UserInputSubmittedAnswer[] }
      | { outcome: "cancelled" },
  ) => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? getSessionRecord(sessionId) : null;
    const userInput = slot?.transcript
      ? selectPendingUserInputInteraction(slot.transcript)
      : null;
    if (!sessionId || !userInput) {
      logInteractionDebug("resolve.skipped_no_pending", {
        action: "user_input",
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
        slot,
      });
      return;
    }

    const request: ResolveInteractionRequest = input.outcome === "submitted"
      ? { outcome: "submitted", answers: input.answers }
      : { outcome: "cancelled" };
    enqueueResolveInteraction({
      action: "user_input",
      sessionId,
      selectedWorkspaceId: state.selectedWorkspaceId,
      slot,
      requestId: userInput.requestId,
      request,
      requestExtra: {
        outcome: input.outcome,
        answerCount: input.outcome === "submitted" ? input.answers.length : 0,
      },
    });
  }, [enqueueResolveInteraction]);

  const resolveMcpElicitation = useCallback(async (
    input:
      | { outcome: "accepted"; fields: McpElicitationSubmittedField[] }
      | { outcome: "declined" }
      | { outcome: "cancelled" },
  ) => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? getSessionRecord(sessionId) : null;
    const mcpElicitation = slot?.transcript
      ? selectPendingMcpElicitationInteraction(slot.transcript)
      : null;
    if (!sessionId || !mcpElicitation) {
      logInteractionDebug("resolve.skipped_no_pending", {
        action: "mcp_elicitation",
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
        slot,
      });
      return;
    }

    const request: ResolveInteractionRequest = input.outcome === "accepted"
      ? { outcome: "accepted", fields: input.fields }
      : { outcome: input.outcome };
    enqueueResolveInteraction({
      action: "mcp_elicitation",
      sessionId,
      selectedWorkspaceId: state.selectedWorkspaceId,
      slot,
      requestId: mcpElicitation.requestId,
      request,
      requestExtra: {
        outcome: input.outcome,
        fieldCount: input.outcome === "accepted" ? input.fields.length : 0,
      },
    });
  }, [enqueueResolveInteraction]);

  const revealMcpElicitationUrl = useCallback(async (): Promise<McpElicitationUrlRevealResponse | null> => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? getSessionRecord(sessionId) : null;
    const mcpElicitation = slot?.transcript
      ? selectPendingMcpElicitationInteraction(slot.transcript)
      : null;
    if (!sessionId || !mcpElicitation) {
      logInteractionDebug("reveal_url.skipped_no_pending", {
        action: "mcp_elicitation",
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
        slot,
      });
      return null;
    }
    const blockedReason = getWorkspaceRuntimeBlockReason(slot?.workspaceId ?? state.selectedWorkspaceId);
    if (blockedReason) {
      logInteractionDebug("reveal_url.blocked", {
        action: "mcp_elicitation",
        sessionId,
        selectedWorkspaceId: state.selectedWorkspaceId,
        slot,
        requestId: mcpElicitation.requestId,
        extra: { blockedReason },
      });
      throw new Error(blockedReason);
    }
    const { workspaceId, materializedSessionId } = await getSessionClientAndWorkspace(sessionId);
    const response = await revealMcpElicitationUrlMutation.mutateAsync({
      workspaceId,
      sessionId: materializedSessionId,
      requestId: mcpElicitation.requestId,
    });
    logInteractionDebug("reveal_url.success", {
      action: "mcp_elicitation",
      sessionId,
      selectedWorkspaceId: state.selectedWorkspaceId,
      slot,
      requestId: mcpElicitation.requestId,
      extra: { hasUrl: Boolean(response.url) },
    });
    return response;
  }, [
    getWorkspaceRuntimeBlockReason,
    revealMcpElicitationUrlMutation,
  ]);

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

function logInteractionDebug(
  event: string,
  input: {
    action: InteractionAction;
    sessionId: string | null;
    selectedWorkspaceId: string | null;
    slot: SessionRuntimeRecord | null;
    requestId?: string | null;
    extra?: Record<string, unknown>;
  },
): void {
  logLatency(`session.interaction.${event}`, {
    action: input.action,
    sessionId: input.sessionId,
    selectedWorkspaceId: input.selectedWorkspaceId,
    requestId: input.requestId ?? null,
    slotWorkspaceId: input.slot?.workspaceId ?? null,
    slotMaterializedSessionId: input.slot?.materializedSessionId ?? null,
    slotStatus: input.slot?.status ?? null,
    transcriptHydrated: input.slot?.transcriptHydrated ?? null,
    streamConnectionState: input.slot?.streamConnectionState ?? null,
    transcriptLastSeq: input.slot?.transcript.lastSeq ?? null,
    pendingInteractions: input.slot?.transcript.pendingInteractions.map((interaction) => ({
      requestId: interaction.requestId,
      kind: interaction.kind,
      toolCallId: interaction.toolCallId ?? null,
      toolKind: interaction.toolKind ?? null,
      toolStatus: interaction.toolStatus ?? null,
      linkedPlanId: interaction.linkedPlanId ?? null,
    })) ?? [],
    ...(input.extra ?? {}),
  });
}
