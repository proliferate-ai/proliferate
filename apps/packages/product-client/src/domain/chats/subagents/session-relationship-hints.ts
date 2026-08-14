import type { SessionSubagentsResponse } from "@anyharness/sdk";

export interface SubagentSessionRelationshipHint {
  sessionId: string;
  parentSessionId: string;
  sessionLinkId: string | null;
}

export function collectSubagentSessionRelationshipHints(
  sessionId: string,
  subagents: SessionSubagentsResponse | null | undefined,
): SubagentSessionRelationshipHint[] {
  const hintsBySessionId = new Map<string, SubagentSessionRelationshipHint>();
  if (subagents?.parent.parent) {
    hintsBySessionId.set(sessionId, {
      sessionId,
      parentSessionId: subagents.parent.parent.sessionId,
      sessionLinkId: null,
    });
  }

  for (const child of subagents?.children ?? []) {
    hintsBySessionId.set(child.agent.identity.sessionId, {
      sessionId: child.agent.identity.sessionId,
      parentSessionId: subagents?.parent.identity.sessionId ?? sessionId,
      sessionLinkId: child.relationship.sessionLinkId,
    });
  }

  return [...hintsBySessionId.values()];
}
