import { useCallback } from "react";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import { useFetchSessionMutation } from "@anyharness/sdk-react";
import {
  createSessionRecordFromSummary,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import type { SessionRelationship } from "@/stores/sessions/session-types";

interface MountLinkedSessionInput {
  sessionId: string;
  label?: string | null;
  workspaceId: string | null;
  sessionRelationship?: SessionRelationship;
  requestHeaders?: HeadersInit;
}

interface MountSubagentChildInput {
  childSessionId: string;
  label?: string | null;
  workspaceId: string | null;
  parentSessionId: string | null;
  sessionLinkId?: string | null;
  requestHeaders?: HeadersInit;
}

export function useLinkedSessionMounting() {
  const fetchSessionMutation = useFetchSessionMutation();
  const mountLinkedSessionSlot = useCallback(async (
    input: MountLinkedSessionInput,
  ): Promise<void> => {
    if (!input.workspaceId) {
      return;
    }

    const existing = getSessionRecord(input.sessionId);
    if (existing?.workspaceId === input.workspaceId) {
      return;
    }

    try {
      const session = await fetchSessionMutation.mutateAsync({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        requestOptions: input.requestHeaders ? { headers: input.requestHeaders } : undefined,
      });

      if (getSessionRecord(input.sessionId)) {
        return;
      }

      putSessionRecord(
        createSessionRecordFromSummary(session, input.workspaceId, {
          titleFallback: input.label ?? null,
          transcriptHydrated: false,
          sessionRelationship: input.sessionRelationship,
        }),
      );
    } catch {
      // Linked session mounting is opportunistic. The source transcript still
      // contains durable metadata and users can open the linked session later.
    }
  }, [fetchSessionMutation]);

  const mountSubagentChildSession = useCallback((
    input: MountSubagentChildInput,
  ): Promise<void> => mountLinkedSessionSlot({
    sessionId: input.childSessionId,
    label: input.label,
    workspaceId: input.workspaceId,
    sessionRelationship: {
      kind: "subagent_child",
      parentSessionId: input.parentSessionId,
      sessionLinkId: input.sessionLinkId,
      relation: "subagent",
      workspaceId: input.workspaceId,
    },
    requestHeaders: input.requestHeaders,
  }), [mountLinkedSessionSlot]);

  const mountSubagentChildrenFromEvents = useCallback((
    parentWorkspaceId: string | null,
    events: readonly SessionEventEnvelope[],
    requestHeaders?: HeadersInit,
  ): void => {
    if (!parentWorkspaceId) {
      return;
    }

    const seenChildSessionIds = new Set<string>();
    for (const envelope of events) {
      const event = envelope.event;
      if (event.type !== "subagent_turn_completed") {
        continue;
      }
      if (seenChildSessionIds.has(event.childSessionId)) {
        continue;
      }
      seenChildSessionIds.add(event.childSessionId);
      void mountSubagentChildSession({
        childSessionId: event.childSessionId,
        label: event.label ?? null,
        workspaceId: parentWorkspaceId,
        parentSessionId: event.parentSessionId,
        sessionLinkId: event.sessionLinkId,
        requestHeaders,
      });
    }
  }, [mountSubagentChildSession]);

  return {
    mountSubagentChildSession,
    mountSubagentChildrenFromEvents,
  };
}
