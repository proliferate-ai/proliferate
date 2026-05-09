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
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function useSessionInteractionActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const resolveInteractionMutation = useResolveSessionInteractionMutation();
  const revealMcpElicitationUrlMutation = useRevealMcpElicitationUrlMutation();

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
      return;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(slot?.workspaceId ?? state.selectedWorkspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const { materializedSessionId, workspaceId } = await getSessionClientAndWorkspace(sessionId);
    const request: ResolveInteractionRequest = input.optionId
      ? { outcome: "selected", optionId: input.optionId }
      : { outcome: "decision", decision: input.decision ?? "deny" };
    await resolveInteractionMutation.mutateAsync(
      {
        workspaceId,
        sessionId: materializedSessionId,
        requestId: permission.requestId,
        request,
      },
    );
  }, [getWorkspaceRuntimeBlockReason, resolveInteractionMutation]);

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
      return;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(slot?.workspaceId ?? state.selectedWorkspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const { materializedSessionId, workspaceId } = await getSessionClientAndWorkspace(sessionId);
    const request: ResolveInteractionRequest = input.outcome === "submitted"
      ? { outcome: "submitted", answers: input.answers }
      : { outcome: "cancelled" };
    await resolveInteractionMutation.mutateAsync({
      workspaceId,
      sessionId: materializedSessionId,
      requestId: userInput.requestId,
      request,
    });
  }, [getWorkspaceRuntimeBlockReason, resolveInteractionMutation]);

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
      return;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(slot?.workspaceId ?? state.selectedWorkspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const { materializedSessionId, workspaceId } = await getSessionClientAndWorkspace(sessionId);
    const request: ResolveInteractionRequest = input.outcome === "accepted"
      ? { outcome: "accepted", fields: input.fields }
      : { outcome: input.outcome };
    await resolveInteractionMutation.mutateAsync({
      workspaceId,
      sessionId: materializedSessionId,
      requestId: mcpElicitation.requestId,
      request,
    });
  }, [getWorkspaceRuntimeBlockReason, resolveInteractionMutation]);

  const revealMcpElicitationUrl = useCallback(async (): Promise<McpElicitationUrlRevealResponse | null> => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    const slot = sessionId ? getSessionRecord(sessionId) : null;
    const mcpElicitation = slot?.transcript
      ? selectPendingMcpElicitationInteraction(slot.transcript)
      : null;
    if (!sessionId || !mcpElicitation) {
      return null;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(slot?.workspaceId ?? state.selectedWorkspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const { materializedSessionId, workspaceId } = await getSessionClientAndWorkspace(sessionId);
    return revealMcpElicitationUrlMutation.mutateAsync({
      workspaceId,
      sessionId: materializedSessionId,
      requestId: mcpElicitation.requestId,
    });
  }, [getWorkspaceRuntimeBlockReason, revealMcpElicitationUrlMutation]);

  return {
    resolvePermission,
    resolveMcpElicitation,
    resolveUserInput,
    revealMcpElicitationUrl,
  };
}
