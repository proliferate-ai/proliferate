import type { ReviewRunDetail } from "@anyharness/sdk";
import type { StartingReviewState } from "@/stores/reviews/review-ui-store";
import { useActiveReviewRunState } from "@/hooks/reviews/derived/use-active-review-run-state";
import { useReviewSessionRelationshipHints } from "@/hooks/reviews/lifecycle/use-review-session-relationship-hints";

export function useActiveReviewRun(): {
  run: ReviewRunDetail | null;
  startingReview: StartingReviewState | null;
  isLoading: boolean;
  hasBlockingReview: boolean;
  hasBusyReview: boolean;
} {
  const state = useActiveReviewRunState();
  useReviewSessionRelationshipHints({
    reviews: state.reviews,
    selectedWorkspaceId: state.selectedWorkspaceId,
  });

  return {
    run: state.run,
    startingReview: state.startingReview,
    isLoading: state.isLoading,
    hasBlockingReview: state.hasBlockingReview,
    hasBusyReview: state.hasBusyReview,
  };
}
