import type {
  PendingInteraction,
  Session,
  SessionActionCapabilities,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionMcpBindingSummary,
  SessionStatus,
  TranscriptState,
} from "@anyharness/sdk";
import { resolveStatusFromExecutionSummary } from "@/lib/domain/sessions/activity";

export interface SessionSlotSummaryPatch {
  agentKind: string;
  workspaceId: string;
  modelId: string | null;
  modeId: string | null;
  title: string | null;
  actionCapabilities: SessionActionCapabilities;
  liveConfig: SessionLiveConfigSnapshot | null;
  executionSummary: SessionExecutionSummary | null;
  mcpBindingSummaries: SessionMcpBindingSummary[] | null;
  status: SessionStatus | null;
  lastPromptAt: string | null;
  transcript: TranscriptState;
}

export function buildSessionSlotPatchFromSummary(
  session: Session,
  workspaceId: string,
  transcript: TranscriptState,
): SessionSlotSummaryPatch {
  const modeId =
    session.liveConfig?.normalizedControls.mode?.currentValue
    ?? session.modeId
    ?? null;
  const title = session.title ?? null;

  return {
    agentKind: session.agentKind,
    workspaceId,
    modelId: session.modelId ?? null,
    modeId,
    title,
    actionCapabilities: session.actionCapabilities,
    liveConfig: session.liveConfig ?? null,
    executionSummary: session.executionSummary ?? null,
    mcpBindingSummaries: session.mcpBindingSummaries ?? null,
    status: resolveStatusFromExecutionSummary(session.executionSummary, session.status),
    lastPromptAt: session.lastPromptAt ?? null,
    transcript: {
      ...transcript,
      currentModeId: modeId ?? transcript.currentModeId,
      sessionMeta: {
        ...transcript.sessionMeta,
        title: title ?? transcript.sessionMeta.title ?? null,
      },
      pendingPrompts: (session.pendingPrompts ?? []).map((entry) => ({
        seq: entry.seq,
        promptId: entry.promptId ?? null,
        text: entry.text,
        contentParts: entry.contentParts ?? [],
        queuedAt: entry.queuedAt,
        promptProvenance: entry.promptProvenance ?? null,
      })),
      pendingInteractions: pendingInteractionsFromExecutionSummary(
        session.executionSummary,
        transcript.pendingInteractions,
      ),
    },
  };
}

function pendingInteractionsFromExecutionSummary(
  executionSummary: SessionExecutionSummary | null | undefined,
  fallback: PendingInteraction[],
): PendingInteraction[] {
  if (!executionSummary) return fallback;

  return (executionSummary.pendingInteractions ?? []).flatMap((interaction): PendingInteraction[] => {
    const base = {
      requestId: interaction.requestId,
      toolCallId: interaction.source.toolCallId ?? null,
      toolKind: interaction.source.toolKind ?? null,
      toolStatus: interaction.source.toolStatus ?? null,
      linkedPlanId: interaction.source.linkedPlanId ?? null,
      title: interaction.title,
      description: interaction.description ?? null,
    };
    if (interaction.kind === "permission" && interaction.payload.type === "permission") {
      return [{
        ...base,
        kind: "permission" as const,
        options: interaction.payload.options ?? [],
        context: interaction.payload.context ?? null,
      }];
    }
    if (interaction.kind === "user_input" && interaction.payload.type === "user_input") {
      return [{
        ...base,
        kind: "user_input" as const,
        questions: interaction.payload.questions ?? [],
      }];
    }
    if (interaction.kind === "mcp_elicitation" && interaction.payload.type === "mcp_elicitation") {
      return [{
        ...base,
        kind: "mcp_elicitation" as const,
        mcpElicitation: {
          serverName: interaction.payload.serverName,
          mode: interaction.payload.mode,
        },
      }];
    }
    return [];
  });
}
