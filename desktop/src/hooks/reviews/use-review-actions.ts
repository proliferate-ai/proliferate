import { useCallback } from "react";
import {
  useSendReviewFeedbackMutation,
  useStopReviewMutation,
  useMarkReviewRevisionReadyMutation,
} from "@anyharness/sdk-react";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/prompt-content";
import {
  type ReviewSetupAnchorRect,
  useReviewUiStore,
} from "@/stores/reviews/review-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useReviewActions() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useHarnessStore((state) => state.activeSessionId);
  const activeSlot = useHarnessStore((state) =>
    state.activeSessionId ? state.sessionSlots[state.activeSessionId] ?? null : null
  );
  const showToast = useToastStore((state) => state.show);
  const openReviewSetup = useReviewUiStore((state) => state.openSetup);
  const stopReviewMutation = useStopReviewMutation({ workspaceId: selectedWorkspaceId });
  const sendReviewFeedbackMutation = useSendReviewFeedbackMutation({
    workspaceId: selectedWorkspaceId,
  });
  const markReviewRevisionReadyMutation = useMarkReviewRevisionReadyMutation({
    workspaceId: selectedWorkspaceId,
  });

  const startPlanReview = useCallback((
    plan: PromptPlanAttachmentDescriptor,
    anchorRect?: ReviewSetupAnchorRect | null,
  ) => {
    const harness = useHarnessStore.getState();
    const planSessionSlot = harness.sessionSlots[plan.sourceSessionId] ?? null;
    if (!planSessionSlot) {
      showToast("Plan session is not available.");
      return;
    }
    if (harness.activeSessionId !== plan.sourceSessionId) {
      showToast("Select the plan's session before starting plan review.");
      return;
    }
    openReviewSetup({ kind: "plan", plan }, anchorRect);
  }, [openReviewSetup, showToast]);

  const startCodeReview = useCallback((anchorRect?: ReviewSetupAnchorRect | null) => {
    if (!activeSessionId || !activeSlot) {
      showToast("Start or select a session before requesting code review.");
      return;
    }
    openReviewSetup({ kind: "code", parentSessionId: activeSessionId }, anchorRect);
  }, [activeSessionId, activeSlot, openReviewSetup, showToast]);

  const stopReview = useCallback((reviewRunId: string) => {
    void stopReviewMutation.mutateAsync(reviewRunId).catch((error) => {
      showToast(`Failed to stop review: ${errorMessage(error)}`);
    });
  }, [showToast, stopReviewMutation]);

  const sendReviewFeedback = useCallback((reviewRunId: string) => {
    void sendReviewFeedbackMutation.mutateAsync(reviewRunId).catch((error) => {
      showToast(`Failed to send review feedback: ${errorMessage(error)}`);
    });
  }, [sendReviewFeedbackMutation, showToast]);

  const markReviewRevisionReady = useCallback((reviewRunId: string) => {
    void markReviewRevisionReadyMutation.mutateAsync({ reviewRunId }).catch((error) => {
      showToast(`Failed to start the next review round: ${errorMessage(error)}`);
    });
  }, [markReviewRevisionReadyMutation, showToast]);

  return {
    startPlanReview,
    startCodeReview,
    stopReview,
    sendReviewFeedback,
    markReviewRevisionReady,
    canStartCodeReview: !!activeSessionId && !!activeSlot,
    isStoppingReview: stopReviewMutation.isPending,
    isSendingReviewFeedback: sendReviewFeedbackMutation.isPending,
    isMarkingReviewRevisionReady: markReviewRevisionReadyMutation.isPending,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
