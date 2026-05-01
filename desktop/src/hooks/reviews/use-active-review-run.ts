import { useMemo } from "react";
import { useSessionReviewsQuery } from "@anyharness/sdk-react";
import type { ReviewRunDetail } from "@anyharness/sdk";
import {
  isReviewRunBlocking,
  isReviewRunBusy,
  selectComposerReviewRun,
} from "@/lib/domain/reviews/review-runs";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";
import type { StartingReviewState } from "@/stores/reviews/review-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useActiveReviewRun(): {
  run: ReviewRunDetail | null;
  startingReview: StartingReviewState | null;
  isLoading: boolean;
  hasBlockingReview: boolean;
  hasBusyReview: boolean;
} {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const dismissedTerminalNoticeRunIds = useReviewUiStore(
    (state) => state.dismissedTerminalNoticeRunIds,
  );
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
    return selectComposerReviewRun(reviews, dismissedTerminalNoticeRunIds);
  }, [dismissedTerminalNoticeRunIds, reviews]);

  const hasBlockingReview = useMemo(() => {
    return reviews?.some(isReviewRunBlocking) ?? false;
  }, [reviews]);

  return {
    run,
    startingReview: activeStartingReview,
    isLoading: reviewsQuery.isLoading,
    hasBlockingReview,
    hasBusyReview: activeStartingReview !== null || (run ? isReviewRunBusy(run) : false),
  };
}
