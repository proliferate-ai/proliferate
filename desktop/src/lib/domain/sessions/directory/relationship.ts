export type SessionRelationship =
  | { kind: "root" }
  | { kind: "pending" }
  | SessionChildRelationship;

export type SessionChildRelationship =
  | {
    kind: "subagent_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "cowork_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "review_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "linked_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  };

export function sessionRelationshipEqual(
  a: SessionRelationship | undefined,
  b: SessionRelationship | undefined,
): boolean {
  if (!a || !b || a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "root" || a.kind === "pending") {
    return true;
  }
  return sessionChildRelationshipEqual(a, b as SessionChildRelationship);
}

export function sessionChildRelationshipEqual(
  a: SessionChildRelationship | undefined,
  b: SessionChildRelationship | undefined,
): boolean {
  return !!a
    && !!b
    && a.kind === b.kind
    && a.parentSessionId === b.parentSessionId
    && (a.sessionLinkId ?? null) === (b.sessionLinkId ?? null)
    && (a.relation ?? null) === (b.relation ?? null)
    && (a.workspaceId ?? null) === (b.workspaceId ?? null);
}
