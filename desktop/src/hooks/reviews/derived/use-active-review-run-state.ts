import { useMemo } from "react";
import type { ReviewRunDetail } from "@anyharness/sdk";
import { useSessionReviewsQuery } from "@anyharness/sdk-react";
import {
  isReviewRunBlocking,
  isReviewRunBusy,
  selectComposerReviewRun,
} from "@/lib/domain/reviews/review-runs";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";
import type { StartingReviewState } from "@/stores/reviews/review-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export interface ActiveReviewRunState {
  reviews: ReviewRunDetail[] | null;
  run: ReviewRunDetail | null;
  startingReview: StartingReviewState | null;
  selectedWorkspaceId: string | null;
  isLoading: boolean;
  hasBlockingReview: boolean;
  hasBusyReview: boolean;
}

export function useActiveReviewRunState(): ActiveReviewRunState {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
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
    reviews,
    run,
    startingReview: activeStartingReview,
    selectedWorkspaceId,
    isLoading: reviewsQuery.isLoading,
    hasBlockingReview,
    hasBusyReview: activeStartingReview !== null || (run ? isReviewRunBusy(run) : false),
  };
}
