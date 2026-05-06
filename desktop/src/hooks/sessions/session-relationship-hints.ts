import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

export interface RecordChildRelationshipHintInput {
  sessionId: string;
  parentSessionId: string | null;
  sessionLinkId?: string | null;
  workspaceId?: string | null;
}

export function recordSubagentChildRelationshipHint(
  input: RecordChildRelationshipHintInput,
) {
  useSessionDirectoryStore.getState().recordRelationshipHint(input.sessionId, {
    kind: "subagent_child",
    parentSessionId: input.parentSessionId,
    sessionLinkId: input.sessionLinkId ?? null,
    relation: "subagent",
    workspaceId: input.workspaceId ?? null,
  });
}

export function recordLinkedChildRelationshipHint(
  input: RecordChildRelationshipHintInput & { relation?: string | null },
) {
  if (!input.parentSessionId) {
    return;
  }
  useSessionDirectoryStore.getState().recordRelationshipHint(input.sessionId, {
    kind: "linked_child",
    parentSessionId: input.parentSessionId,
    sessionLinkId: input.sessionLinkId ?? null,
    relation: input.relation ?? "linked_child",
    workspaceId: input.workspaceId ?? null,
  });
}
