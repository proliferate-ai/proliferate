import type { ReviewRunDetail } from "@anyharness/sdk";

export interface ReviewSessionRelationshipHint {
  sessionId: string;
  parentSessionId: string;
  sessionLinkId: string | null;
}

export function collectReviewSessionRelationshipHints(
  reviews: readonly ReviewRunDetail[] | null | undefined,
): ReviewSessionRelationshipHint[] {
  const hintsBySessionId = new Map<string, ReviewSessionRelationshipHint>();
  for (const run of reviews ?? []) {
    for (const round of run.rounds) {
      for (const assignment of round.assignments) {
        const sessionId = assignment.reviewerSessionId?.trim();
        if (!sessionId) {
          continue;
        }
        hintsBySessionId.set(sessionId, {
          sessionId,
          parentSessionId: run.parentSessionId,
          sessionLinkId: assignment.sessionLinkId?.trim() || null,
        });
      }
    }
  }
  return [...hintsBySessionId.values()];
}
