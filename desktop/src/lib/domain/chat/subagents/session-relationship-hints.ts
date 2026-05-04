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
  if (subagents?.parent) {
    hintsBySessionId.set(sessionId, {
      sessionId,
      parentSessionId: subagents.parent.parentSessionId,
      sessionLinkId: subagents.parent.sessionLinkId ?? null,
    });
  }

  for (const child of subagents?.children ?? []) {
    hintsBySessionId.set(child.childSessionId, {
      sessionId: child.childSessionId,
      parentSessionId: sessionId,
      sessionLinkId: child.sessionLinkId ?? null,
    });
  }

  return [...hintsBySessionId.values()];
}
