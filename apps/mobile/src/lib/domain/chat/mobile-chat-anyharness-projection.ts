import type {
  PendingInteraction,
  Session,
  SessionEventEnvelope,
  SessionExecutionSummary,
} from "@anyharness/sdk";
import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudSessionProjection,
} from "@proliferate/cloud-sdk";

export function cloudSessionProjectionFromAnyHarness(
  session: Session,
  cloudWorkspaceId: string,
  anyharnessWorkspaceId: string,
): CloudSessionProjection {
  return {
    cloudWorkspaceId,
    targetId: cloudWorkspaceId,
    workspaceId: session.workspaceId ?? anyharnessWorkspaceId,
    sessionId: session.id,
    nativeSessionId: session.id,
    sourceAgentKind: session.agentKind ?? null,
    title: session.title ?? null,
    status: session.status,
    phase: session.executionSummary?.phase ?? session.status ?? null,
    pendingInteractionCount: session.executionSummary?.pendingInteractions?.length ?? 0,
    executionSummary: session.executionSummary ?? null,
    liveConfig: session.liveConfig ?? null,
    lastEventSeq: 0,
    lastEventAt: session.updatedAt ?? session.lastPromptAt ?? session.createdAt ?? null,
    startedAt: session.createdAt ?? null,
    endedAt: null,
  };
}

export function cloudPendingInteractionsFromExecutionSummary(
  executionSummary: SessionExecutionSummary | null | undefined,
  sessionId: string | null,
): CloudPendingInteraction[] {
  return (executionSummary?.pendingInteractions ?? []).map((interaction) => ({
    requestId: interaction.requestId,
    sessionId,
    status: "pending",
    kind: interaction.kind,
    title: interaction.title,
    description: interaction.description ?? null,
    toolCallId: interaction.source.toolCallId ?? null,
    toolKind: interaction.source.toolKind ?? null,
    toolStatus: interaction.source.toolStatus ?? null,
    linkedPlanId: interaction.source.linkedPlanId ?? null,
    ...(interaction.payload.type === "permission"
      ? {
        options: interaction.payload.options ?? [],
        context: interaction.payload.context ?? null,
      }
      : {}),
    ...(interaction.payload.type === "user_input"
      ? { questions: interaction.payload.questions ?? [] }
      : {}),
    ...(interaction.payload.type === "mcp_elicitation"
      ? {
        mcpElicitation: {
          serverName: interaction.payload.serverName,
          mode: interaction.payload.mode,
        },
      }
      : {}),
  }));
}

export function cloudPendingInteractionsFromReducer(
  pendingInteractions: readonly PendingInteraction[],
  sessionId: string,
): CloudPendingInteraction[] {
  return pendingInteractions.map((interaction) => ({
    requestId: interaction.requestId,
    sessionId,
    status: "pending",
    kind: interaction.kind,
    title: interaction.title,
    description: interaction.description ?? null,
    toolCallId: interaction.toolCallId ?? null,
    toolKind: interaction.toolKind ?? null,
    toolStatus: interaction.toolStatus ?? null,
    linkedPlanId: interaction.linkedPlanId ?? null,
    ...(interaction.kind === "permission"
      ? {
        options: interaction.options ?? [],
        context: interaction.context ?? null,
      }
      : {}),
    ...(interaction.kind === "user_input"
      ? { questions: interaction.questions ?? [] }
      : {}),
    ...(interaction.kind === "mcp_elicitation"
      ? { mcpElicitation: interaction.mcpElicitation }
      : {}),
  }));
}

export function cloudSessionEventFromAnyHarness(
  envelope: SessionEventEnvelope,
  cloudWorkspaceId: string,
  sessionId: string,
): CloudSessionEvent {
  return {
    targetId: cloudWorkspaceId,
    sessionId,
    cloudWorkspaceId,
    seq: envelope.seq,
    eventType: envelope.event.type,
    sourceKind: "anyharness",
    turnId: null,
    itemId: null,
    occurredAt: envelope.timestamp ?? new Date().toISOString(),
    payload: envelope.event as unknown as Record<string, unknown>,
    envelope: envelope as unknown as Record<string, unknown>,
  };
}
