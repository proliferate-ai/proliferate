import { useMemo } from "react";
import { useSessionReviewsQuery } from "@anyharness/sdk-react";
import type { ReviewRunDetail } from "@anyharness/sdk";
import {
  isReviewRunBusy,
  isReviewRunTerminal,
  isReviewRunShowable,
} from "@/lib/domain/reviews/review-runs";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";
import type { StartingReviewState } from "@/stores/reviews/review-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useActiveReviewRun(): {
  run: ReviewRunDetail | null;
  startingReview: StartingReviewState | null;
  isLoading: boolean;
  hasBusyReview: boolean;
} {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const dismissedTerminalRunIds = useReviewUiStore((state) => state.dismissedTerminalRunIds);
  const startingReview = useReviewUiStore((state) => state.startingReview);
  const activeStartingReview = startingReview?.parentSessionId === activeSessionId
    ? startingReview
    : null;
  const reviewsQuery = useSessionReviewsQuery(activeSessionId, {
    workspaceId: selectedWorkspaceId,
    enabled: !!activeSessionId,
    refetchInterval: 5000,
  });
  const reviews = reviewsQuery.data?.reviews ?? null;

  const run = useMemo(() => {
    return reviews?.find((candidate) => {
      if (!isReviewRunShowable(candidate)) {
        return false;
      }
      return !isReviewRunTerminal(candidate)
        || !dismissedTerminalRunIds.includes(candidate.id);
    }) ?? null;
  }, [dismissedTerminalRunIds, reviews]);

  return {
    run,
    startingReview: activeStartingReview,
    isLoading: reviewsQuery.isLoading,
    hasBusyReview: activeStartingReview !== null || (run ? isReviewRunBusy(run) : false),
  };
}
