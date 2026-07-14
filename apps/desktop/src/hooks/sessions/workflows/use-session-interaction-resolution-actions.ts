import type { ResolveInteractionRequest } from "@anyharness/sdk";
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
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  sessionIntentsForSession,
} from "@proliferate/product-domain/sessions/intents/session-intent-state";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import { getSessionClientAndWorkspace } from "@/lib/access/anyharness/session-runtime";
import {
  logInteractionDebug,
  type InteractionAction,
} from "@/hooks/sessions/workflows/session-interaction-debug";

// Resolves pending session interactions (permissions, user input, MCP elicitations).
export function useSessionInteractionResolutionActions() {
  const ssh = useProductHost().desktop?.ssh ?? null;
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const revealMcpElicitationUrlMutation = useRevealMcpElicitationUrlMutation();

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
    const { workspaceId, materializedSessionId } = await getSessionClientAndWorkspace(
      sessionId,
      ssh,
    );
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
    ssh,
  ]);

  return {
    resolvePermission,
    resolveMcpElicitation,
    resolveUserInput,
    revealMcpElicitationUrl,
  };
}
