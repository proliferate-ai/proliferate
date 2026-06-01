import { resolveTrustedSessionSelectionRelationship } from "@/lib/domain/sessions/selection/trusted-session-selection";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "@/lib/domain/sessions/directory/relationship";

export function classifyTrustedSessionSelection(sessionId: string): SessionRelationship {
  const state = useSessionDirectoryStore.getState();
  const slot = state.entriesById[sessionId] ?? null;
  const relationshipHint =
    state.relationshipHintsBySessionId[sessionId] as SessionChildRelationship | undefined;

  const plan = resolveTrustedSessionSelectionRelationship<
    SessionRelationship,
    SessionChildRelationship
  >({
    currentRelationship: slot?.sessionRelationship ?? null,
    relationshipHint,
    rootRelationship: { kind: "root" },
  });

  if (plan.commitAction === "promote_root") {
    state.setSessionRelationship(sessionId, plan.relationship);
  } else if (plan.commitAction === "apply_hint") {
    state.recordRelationshipHint(sessionId, plan.relationship);
  }
  return plan.relationship;
}
