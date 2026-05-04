import { useHarnessStore } from "@/stores/sessions/harness-store";

export interface RecordChildRelationshipHintInput {
  sessionId: string;
  parentSessionId: string | null;
  sessionLinkId?: string | null;
  workspaceId?: string | null;
}

export function recordSubagentChildRelationshipHint(
  input: RecordChildRelationshipHintInput,
) {
  useHarnessStore.getState().recordSessionRelationshipHint(input.sessionId, {
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
  useHarnessStore.getState().recordSessionRelationshipHint(input.sessionId, {
    kind: "linked_child",
    parentSessionId: input.parentSessionId,
    sessionLinkId: input.sessionLinkId ?? null,
    relation: input.relation ?? "linked_child",
    workspaceId: input.workspaceId ?? null,
  });
}
