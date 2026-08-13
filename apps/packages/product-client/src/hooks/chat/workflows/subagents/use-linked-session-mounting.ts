import { useCallback } from "react";
import { useFetchSessionMutation } from "@anyharness/sdk-react";
import {
  createSessionRecordFromSummary,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import type { SessionRelationship } from "#product/lib/domain/sessions/directory/relationship";

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
  const { mutateAsync: fetchSession } = useFetchSessionMutation();
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
      const session = await fetchSession({
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
  }, [fetchSession]);

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

  return {
    mountSubagentChildSession,
  };
}
