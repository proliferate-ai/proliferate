import { useEffect } from "react";
import type { ReviewRunDetail } from "@anyharness/sdk";
import { collectReviewSessionRelationshipHints } from "@/lib/domain/reviews/session-relationship-hints";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

// Owns recording session relationship hints discovered from review runs.
// Does not own active review selection or review actions.
export function useReviewSessionRelationshipHints(args: {
  reviews: ReviewRunDetail[] | null;
  selectedWorkspaceId: string | null;
}): void {
  const recordSessionRelationshipHint = useSessionDirectoryStore(
    (state) => state.recordRelationshipHint,
  );

  useEffect(() => {
    for (const hint of collectReviewSessionRelationshipHints(args.reviews)) {
      recordSessionRelationshipHint(hint.sessionId, {
        kind: "review_child",
        parentSessionId: hint.parentSessionId,
        sessionLinkId: hint.sessionLinkId,
        relation: "review",
        workspaceId: args.selectedWorkspaceId,
      });
    }
  }, [args.reviews, args.selectedWorkspaceId, recordSessionRelationshipHint]);
}
