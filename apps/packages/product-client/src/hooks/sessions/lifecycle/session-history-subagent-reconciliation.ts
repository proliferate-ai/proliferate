import type {
  SessionEventEnvelope,
  SessionSubagentsResponse,
  TranscriptState,
} from "@anyharness/sdk";
import {
  classifyHistoricalRosterCandidates,
  historicalSubagentCandidates,
  planHistoricalAbsentCandidatePromotions,
  planHistoricalWorkspacePromotionAuthority,
  type HistoricalSubagentAuthorityEffect,
} from "#product/lib/domain/sessions/history/history-subagent-authority";

export async function resolveHistorySubagentAuthority(input: {
  parentSessionId: string;
  workspaceId: string;
  events: readonly SessionEventEnvelope[];
  transcript: TranscriptState;
  fetchParentRoster: () => Promise<SessionSubagentsResponse>;
  fetchVisibleSessionIds: () => Promise<ReadonlySet<string>>;
  isCurrent?: () => boolean;
}): Promise<{
  current: boolean;
  effects: HistoricalSubagentAuthorityEffect[];
}> {
  const receiptEffects = planHistoricalWorkspacePromotionAuthority(input);
  const candidates = historicalSubagentCandidates(
    input.parentSessionId,
    input.events,
    input.transcript,
    input.workspaceId,
  );
  let rosterEffects: HistoricalSubagentAuthorityEffect[] = [];
  if (candidates.length > 0) {
    try {
      const roster = await input.fetchParentRoster();
      const classification = classifyHistoricalRosterCandidates({
        parentSessionId: input.parentSessionId,
        workspaceId: input.workspaceId,
        candidates,
        roster,
      });
      if (classification) {
        rosterEffects = classification.confirmedEffects;
        if (classification.absentCandidates.length > 0) {
          try {
            const visibleSessionIds = await input.fetchVisibleSessionIds();
            rosterEffects.push(...planHistoricalAbsentCandidatePromotions({
              workspaceId: input.workspaceId,
              absentCandidates: classification.absentCandidates,
              visibleSessionIds,
            }));
          } catch {
            // The current roster still authorizes relationships it contains.
            // Absence becomes promotion authority only with the second fresh
            // workspace-session signal, so a failed list read adds nothing.
          }
        }
      }
    } catch {
      // A failed roster read grants no relationship authority. Strict receipt
      // effects remain usable, while legacy completion provenance is ignored.
    }
  }
  if (input.isCurrent && !input.isCurrent()) {
    return { current: false, effects: [] };
  }
  return { current: true, effects: [...receiptEffects, ...rosterEffects] };
}

export function applyHistorySubagentAuthority(input: {
  effects: readonly HistoricalSubagentAuthorityEffect[];
  requestHeaders?: HeadersInit;
  resolveClientSessionId: (durableSessionId: string) => string | null;
  recordRelationship: (
    sessionId: string,
    effect: Extract<HistoricalSubagentAuthorityEffect, {
      kind: "record_subagent_relationship";
    }>,
  ) => void;
  markSessionPromoted: (sessionIds: readonly string[], workspaceId: string) => void;
  shouldMountRelationship: (
    sessionIds: readonly string[],
    parentSessionId: string,
    workspaceId: string,
  ) => boolean;
  mountSubagentChildSession: (input: {
    childSessionId: string;
    label: string | null;
    workspaceId: string;
    parentSessionId: string;
    sessionLinkId?: string | null;
    requestHeaders?: HeadersInit;
  }) => Promise<void> | void;
}): void {
  for (const effect of input.effects) {
    const sessionIds = aliasedSessionIds(
      effect.childSessionId,
      input.resolveClientSessionId(effect.childSessionId),
    );
    if (effect.kind === "mark_session_promoted") {
      input.markSessionPromoted(sessionIds, effect.workspaceId);
    } else {
      for (const sessionId of sessionIds) {
        input.recordRelationship(sessionId, effect);
      }
    }
  }

  const mounted = new Set<string>();
  for (let index = input.effects.length - 1; index >= 0; index -= 1) {
    const effect = input.effects[index]!;
    if (effect.kind !== "record_subagent_relationship" || mounted.has(effect.childSessionId)) {
      continue;
    }
    mounted.add(effect.childSessionId);
    const clientSessionId = input.resolveClientSessionId(effect.childSessionId);
    const sessionIds = aliasedSessionIds(effect.childSessionId, clientSessionId);
    if (!input.shouldMountRelationship(
      sessionIds,
      effect.parentSessionId,
      effect.workspaceId,
    )) {
      continue;
    }
    void input.mountSubagentChildSession({
      childSessionId: clientSessionId ?? effect.childSessionId,
      label: effect.label,
      workspaceId: effect.workspaceId,
      parentSessionId: effect.parentSessionId,
      sessionLinkId: effect.sessionLinkId,
      requestHeaders: input.requestHeaders,
    });
  }
}

function aliasedSessionIds(
  durableSessionId: string,
  clientSessionId: string | null,
): string[] {
  return [...new Set([durableSessionId, clientSessionId ?? durableSessionId])];
}
