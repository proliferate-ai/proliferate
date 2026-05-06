import { useEffect, useMemo } from "react";
import { useSessionReviewsQuery } from "@anyharness/sdk-react";
import type { ReviewRunDetail } from "@anyharness/sdk";
import {
  isReviewRunBlocking,
  isReviewRunBusy,
  selectComposerReviewRun,
} from "@/lib/domain/reviews/review-runs";
import { collectReviewSessionRelationshipHints } from "@/lib/domain/reviews/session-relationship-hints";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";
import type { StartingReviewState } from "@/stores/reviews/review-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function useActiveReviewRun(): {
  run: ReviewRunDetail | null;
  startingReview: StartingReviewState | null;
  isLoading: boolean;
  hasBlockingReview: boolean;
  hasBusyReview: boolean;
} {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const dismissedTerminalNoticeRunIds = useReviewUiStore(
    (state) => state.dismissedTerminalNoticeRunIds,
  );
  const startingReview = useReviewUiStore((state) => state.startingReview);
  const recordSessionRelationshipHint = useSessionDirectoryStore(
    (state) => state.recordRelationshipHint,
  );
  const activeStartingReview = startingReview?.parentSessionId === activeSessionId
    ? startingReview
    : null;
  const reviewsQuery = useSessionReviewsQuery(activeSessionId, {
    workspaceId: selectedWorkspaceId,
    enabled: !!activeSessionId,
    refetchInterval: 5000,
  });
  const reviews = reviewsQuery.data?.reviews ?? null;

  useEffect(() => {
    for (const hint of collectReviewSessionRelationshipHints(reviews)) {
      recordSessionRelationshipHint(hint.sessionId, {
        kind: "review_child",
        parentSessionId: hint.parentSessionId,
        sessionLinkId: hint.sessionLinkId,
        relation: "review",
        workspaceId: selectedWorkspaceId,
      });
    }
  }, [recordSessionRelationshipHint, reviews, selectedWorkspaceId]);

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
