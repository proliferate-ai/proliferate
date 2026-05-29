type SessionRelationshipKind = "pending" | string;

export type TrustedSessionSelectionRelationshipPlan<
  TRelationship extends { kind: SessionRelationshipKind },
  TChildRelationship extends TRelationship,
> =
  | {
    commitAction: "none";
    relationship: TRelationship;
  }
  | {
    commitAction: "promote_root";
    relationship: TRelationship;
  }
  | {
    commitAction: "apply_hint";
    relationship: TChildRelationship;
  };

export function resolveTrustedSessionSelectionRelationship<
  TRelationship extends { kind: SessionRelationshipKind },
  TChildRelationship extends TRelationship,
>(input: {
  currentRelationship: TRelationship | null | undefined;
  relationshipHint: TChildRelationship | null | undefined;
  rootRelationship: TRelationship;
}): TrustedSessionSelectionRelationshipPlan<TRelationship, TChildRelationship> {
  if (input.currentRelationship && input.currentRelationship.kind !== "pending") {
    return {
      commitAction: "none",
      relationship: input.currentRelationship,
    };
  }

  if (input.relationshipHint) {
    return {
      commitAction: "apply_hint",
      relationship: input.relationshipHint,
    };
  }

  return {
    commitAction: "promote_root",
    relationship: input.rootRelationship,
  };
}
