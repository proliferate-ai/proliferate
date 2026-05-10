import {
  selectPendingApprovalInteraction,
  selectPendingMcpElicitationInteraction,
  selectPendingUserInputInteraction,
  type McpElicitationSubmittedField,
  type McpElicitationUrlRevealResponse,
  type ResolveInteractionRequest,
  type UserInputSubmittedAnswer,
} from "@anyharness/sdk";
import {
  useResolveSessionInteractionMutation,
  useRevealMcpElicitationUrlMutation,
} from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import {
  getSessionClientAndWorkspace,
} from "@/lib/workflows/sessions/session-runtime";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

type InteractionAction = "permission" | "user_input" | "mcp_elicitation";

export function useSessionInteractionActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const resolveInteractionMutation = useResolveSessionInteractionMutation();
  const revealMcpElicitationUrlMutation = useRevealMcpElicitationUrlMutation();

  const resolvePendingInteraction = useCallback(async (input: {
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

    let materializedSessionId: string | null = null;
    let workspaceId: string | null = null;
    try {
      const resolved = await getSessionClientAndWorkspace(input.sessionId);
      materializedSessionId = resolved.materializedSessionId;
      workspaceId = resolved.workspaceId;
      logInteractionDebug("resolve.request", {
        ...input,
        materializedSessionId,
        workspaceId,
        extra: input.requestExtra,
      });
      await resolveInteractionMutation.mutateAsync({
        workspaceId,
        sessionId: materializedSessionId,
        requestId: input.requestId,
        request: input.request,
      });
      logInteractionDebug("resolve.success", {
        ...input,
        materializedSessionId,
        workspaceId,
      });
    } catch (error) {
      logInteractionDebug("resolve.failed", {
        ...input,
        materializedSessionId,
        workspaceId,
        extra: { errorMessage: resolveErrorMessage(error) },
      });
      throw error;
    }
  }, [getWorkspaceRuntimeBlockReason, resolveInteractionMutation]);

  const revealPendingMcpElicitationUrl = useCallback(async (input: {
    sessionId: string;
    selectedWorkspaceId: string | null;
    slot: SessionRuntimeRecord | null;
    requestId: string;
  }): Promise<McpElicitationUrlRevealResponse> => {
    const blockedReason = getWorkspaceRuntimeBlockReason(input.slot?.workspaceId ?? input.selectedWorkspaceId);
    if (blockedReason) {
      logInteractionDebug("reveal_url.blocked", {
        action: "mcp_elicitation",
        ...input,
        extra: { blockedReason },
      });
      throw new Error(blockedReason);
    }

    let materializedSessionId: string | null = null;
    let workspaceId: string | null = null;
    try {
      const resolved = await getSessionClientAndWorkspace(input.sessionId);
      materializedSessionId = resolved.materializedSessionId;
      workspaceId = resolved.workspaceId;
      logInteractionDebug("reveal_url.request", {
        action: "mcp_elicitation",
        ...input,
        materializedSessionId,
        workspaceId,
      });
      const response = await revealMcpElicitationUrlMutation.mutateAsync({
        workspaceId,
        sessionId: materializedSessionId,
        requestId: input.requestId,
      });
      logInteractionDebug("reveal_url.success", {
        action: "mcp_elicitation",
        ...input,
        materializedSessionId,
        workspaceId,
        extra: { hasUrl: Boolean(response.url) },
      });
      return response;
    } catch (error) {
      logInteractionDebug("reveal_url.failed", {
        action: "mcp_elicitation",
        ...input,
        materializedSessionId,
        workspaceId,
        extra: { errorMessage: resolveErrorMessage(error) },
      });
      throw error;
    }
  }, [getWorkspaceRuntimeBlockReason, revealMcpElicitationUrlMutation]);

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
    await resolvePendingInteraction({
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
  }, [resolvePendingInteraction]);

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
    await resolvePendingInteraction({
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
  }, [resolvePendingInteraction]);

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
    await resolvePendingInteraction({
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
  }, [resolvePendingInteraction]);

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

    return revealPendingMcpElicitationUrl({
      sessionId,
      selectedWorkspaceId: state.selectedWorkspaceId,
      slot,
      requestId: mcpElicitation.requestId,
    });
  }, [revealPendingMcpElicitationUrl]);

  return {
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
    materializedSessionId?: string | null;
    workspaceId?: string | null;
    extra?: Record<string, unknown>;
  },
): void {
  logLatency(`session.interaction.${event}`, {
    action: input.action,
    sessionId: input.sessionId,
    selectedWorkspaceId: input.selectedWorkspaceId,
    requestId: input.requestId ?? null,
    resolvedWorkspaceId: input.workspaceId ?? null,
    resolvedMaterializedSessionId: input.materializedSessionId ?? null,
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

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
