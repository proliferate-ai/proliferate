import type {
  SessionEventEnvelope,
  SessionSubagentsResponse,
  ToolCallItem,
  TranscriptState,
} from "@anyharness/sdk";
import {
  deriveAuthoritativeAgentOperation,
} from "#product/lib/domain/sessions/agent-operations-authority";

export type HistoricalSubagentAuthorityEffect =
  | {
    kind: "record_subagent_relationship";
    childSessionId: string;
    label: string | null;
    workspaceId: string;
    parentSessionId: string;
    sessionLinkId: string | null;
  }
  | {
    kind: "mark_session_promoted";
    childSessionId: string;
    workspaceId: string;
  };

export interface HistoricalSubagentCandidate {
  childSessionId: string;
  label: string | null;
  sessionLinkId: string | null;
}

export function planHistoricalWorkspacePromotionAuthority(input: {
  parentSessionId: string;
  workspaceId: string;
  transcript: TranscriptState;
}): HistoricalSubagentAuthorityEffect[] {
  const completedTools = Object.values(input.transcript.itemsById)
    .filter((item): item is ToolCallItem => item.kind === "tool_call" && item.status === "completed")
    .sort((left, right) => (
      (left.completedSeq ?? left.lastUpdatedSeq) - (right.completedSeq ?? right.lastUpdatedSeq)
    ));
  const effects: HistoricalSubagentAuthorityEffect[] = [];
  for (const item of completedTools) {
    const operation = deriveAuthoritativeAgentOperation(
      item,
      input.parentSessionId,
      input.workspaceId,
    );
    if (
      operation?.action === "promote_subagent"
      && operation.agent?.role === "ordinary"
      && operation.agent.sessionId
    ) {
      effects.push({
        kind: "mark_session_promoted",
        childSessionId: operation.agent.sessionId,
        workspaceId: input.workspaceId,
      });
    }
  }
  return effects;
}

export function historicalSubagentCandidates(
  parentSessionId: string,
  events: readonly SessionEventEnvelope[],
  transcript: TranscriptState,
  workspaceId: string,
): HistoricalSubagentCandidate[] {
  const candidates = new Map<string, HistoricalSubagentCandidate>();
  for (const envelope of events) {
    const event = envelope.event;
    if (
      event.type !== "subagent_turn_completed"
      || event.parentSessionId !== parentSessionId
    ) {
      continue;
    }
    candidates.set(event.childSessionId, {
      childSessionId: event.childSessionId,
      label: event.label ?? null,
      sessionLinkId: event.sessionLinkId,
    });
  }
  for (const item of Object.values(transcript.itemsById)) {
    if (item.kind !== "tool_call" || item.status !== "completed") {
      continue;
    }
    const operation = deriveAuthoritativeAgentOperation(
      item,
      parentSessionId,
      workspaceId,
    );
    if (
      operation?.action === "create_agent"
      && operation.agent?.role === "subagent"
      && operation.agent.sessionId
    ) {
      candidates.set(operation.agent.sessionId, {
        childSessionId: operation.agent.sessionId,
        label: operation.agent.title,
        sessionLinkId: null,
      });
    }
  }
  return [...candidates.values()];
}

/**
 * A successfully fetched parent roster is current relationship truth. Legacy
 * completion events may identify candidates, but cannot recreate a child that
 * the roster no longer contains.
 */
export function classifyHistoricalRosterCandidates(input: {
  parentSessionId: string;
  workspaceId: string;
  candidates: readonly HistoricalSubagentCandidate[];
  roster: SessionSubagentsResponse;
}): {
  confirmedEffects: HistoricalSubagentAuthorityEffect[];
  absentCandidates: HistoricalSubagentCandidate[];
} | null {
  if (
    input.roster.parent.identity.sessionId !== input.parentSessionId
    || input.roster.parent.workspace.workspaceId !== input.workspaceId
  ) {
    return null;
  }
  const children = new Map(input.roster.children.flatMap((entry) => {
    const childSessionId = entry.agent.identity.sessionId;
    const valid = entry.agent.role === "subagent"
      && entry.agent.workspace.workspaceId === input.workspaceId
      && entry.agent.parent?.sessionId === input.parentSessionId
      && entry.relationship.parentSessionId === input.parentSessionId
      && entry.relationship.childSessionId === childSessionId;
    return valid ? [[childSessionId, entry] as const] : [];
  }));
  const confirmedEffects: HistoricalSubagentAuthorityEffect[] = [];
  const absentCandidates: HistoricalSubagentCandidate[] = [];
  for (const candidate of input.candidates) {
    const child = children.get(candidate.childSessionId);
    if (child) {
      confirmedEffects.push({
        kind: "record_subagent_relationship",
        childSessionId: candidate.childSessionId,
        label: child.relationship.label ?? child.agent.title ?? candidate.label,
        workspaceId: input.workspaceId,
        parentSessionId: input.parentSessionId,
        sessionLinkId: child.relationship.sessionLinkId,
      });
    } else {
      absentCandidates.push(candidate);
    }
  }
  return { confirmedEffects, absentCandidates };
}

export function planHistoricalAbsentCandidatePromotions(input: {
  workspaceId: string;
  absentCandidates: readonly HistoricalSubagentCandidate[];
  visibleSessionIds: ReadonlySet<string>;
}): HistoricalSubagentAuthorityEffect[] {
  return input.absentCandidates.flatMap((candidate) =>
    input.visibleSessionIds.has(candidate.childSessionId)
      ? [{
        kind: "mark_session_promoted" as const,
        childSessionId: candidate.childSessionId,
        workspaceId: input.workspaceId,
      }]
      : []
  );
}
