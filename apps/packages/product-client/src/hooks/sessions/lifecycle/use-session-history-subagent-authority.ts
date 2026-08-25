import { useCallback } from "react";
import type { SessionEventEnvelope, TranscriptState } from "@anyharness/sdk";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useLinkedSessionMounting } from "#product/hooks/chat/workflows/subagents/use-linked-session-mounting";
import {
  fetchSessionSubagentRoster,
  fetchSessionWorkspaceSummaries,
} from "#product/lib/access/anyharness/session-runtime";
import {
  applyHistorySubagentAuthority,
  resolveHistorySubagentAuthority,
} from "#product/hooks/sessions/lifecycle/session-history-subagent-reconciliation";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

export interface SessionHistorySubagentAuthorityInput {
  sessionId: string;
  parentSessionId: string;
  workspaceId: string | null;
  events: readonly SessionEventEnvelope[];
  transcript: TranscriptState;
  requestHeaders?: HeadersInit;
  isCurrent?: () => boolean;
}

export function useSessionHistorySubagentAuthority() {
  const host = useProductHost();
  const cloudClient = host.cloud.client;
  const { mountSubagentChildSession } = useLinkedSessionMounting();

  const resolveAuthority = useCallback((input: SessionHistorySubagentAuthorityInput) => {
    if (!input.workspaceId) {
      return Promise.resolve({
        current: !input.isCurrent || input.isCurrent(),
        effects: [],
      });
    }
    return resolveHistorySubagentAuthority({
      parentSessionId: input.parentSessionId,
      workspaceId: input.workspaceId,
      events: input.events,
      transcript: input.transcript,
      fetchParentRoster: () => fetchSessionSubagentRoster(input.sessionId, {
        requestHeaders: input.requestHeaders,
        cloudClient,
      }),
      fetchVisibleSessionIds: async () => new Set(
        (await fetchSessionWorkspaceSummaries(input.sessionId, {
          cloudClient,
        })).map((session) => session.id),
      ),
      isCurrent: input.isCurrent,
    });
  }, [cloudClient]);

  const applyAuthority = useCallback((
    effects: Awaited<ReturnType<typeof resolveHistorySubagentAuthority>>["effects"],
    requestHeaders?: HeadersInit,
  ) => {
    applyHistorySubagentAuthority({
      effects,
      requestHeaders,
      resolveClientSessionId: (durableSessionId) =>
        useSessionDirectoryStore.getState()
          .clientSessionIdByMaterializedSessionId[durableSessionId] ?? null,
      recordRelationship: (sessionId, effect) => {
        useSessionDirectoryStore.getState().recordRelationshipHint(sessionId, {
          kind: "subagent_child",
          parentSessionId: effect.parentSessionId,
          sessionLinkId: effect.sessionLinkId,
          relation: "subagent",
          workspaceId: effect.workspaceId,
        });
      },
      markSessionPromoted: (sessionIds, workspaceId) => {
        useSessionDirectoryStore.getState().markSessionPromoted(sessionIds, workspaceId);
      },
      shouldMountRelationship: (sessionIds, parentSessionId, workspaceId) => {
        const state = useSessionDirectoryStore.getState();
        if (sessionIds.some((sessionId) => state.promotedRootSessionIds.has(sessionId))) {
          return false;
        }
        return sessionIds.some((sessionId) => {
          const relationship = state.entriesById[sessionId]?.sessionRelationship
            ?? state.relationshipHintsBySessionId[sessionId];
          return relationship?.kind === "subagent_child"
            && relationship.parentSessionId === parentSessionId
            && relationship.workspaceId === workspaceId;
        });
      },
      mountSubagentChildSession,
    });
  }, [mountSubagentChildSession]);

  return useCallback(async (input: SessionHistorySubagentAuthorityInput): Promise<boolean> => {
    const authority = await resolveAuthority(input);
    if (!authority.current) {
      return false;
    }
    applyAuthority(authority.effects, input.requestHeaders);
    return true;
  }, [applyAuthority, resolveAuthority]);
}
