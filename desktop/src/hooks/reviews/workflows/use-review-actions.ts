import { useCallback } from "react";
import {
  useSendReviewFeedbackMutation,
  useStartCodeReviewMutation,
  useStartPlanReviewMutation,
  useStopReviewMutation,
  useMarkReviewRevisionReadyMutation,
  useRetryReviewAssignmentMutation,
} from "@anyharness/sdk-react";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/composer/prompt-plan-attachments";
import {
  buildStartingReview,
  resolveOneClickReviewRequest,
} from "@/lib/domain/reviews/review-launch";
import {
  materializeReviewParentSession,
  waitForReviewParentSessionMaterialization,
} from "@/lib/workflows/reviews/review-parent-materialization";
import {
  sessionMaterializationDeps,
} from "@/hooks/sessions/workflows/session-materialization-deps";
import {
  type ReviewSetupAnchorRect,
  useReviewUiStore,
} from "@/stores/reviews/review-ui-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

// Owns user-triggered review actions for the active session.
// Does not own review setup dialog form state or active review read models.
export function useReviewActions() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const activeSlot = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId] ?? null : null
  );
  const reviewDefaultsByKind = useUserPreferencesStore((state) => state.reviewDefaultsByKind);
  const reviewPersonalitiesByKind = useUserPreferencesStore((state) => state.reviewPersonalitiesByKind);
  const showToast = useToastStore((state) => state.show);
  const openReviewSetup = useReviewUiStore((state) => state.openSetup);
  const beginStartingReview = useReviewUiStore((state) => state.beginStartingReview);
  const clearStartingReviewForToken = useReviewUiStore((state) => state.clearStartingReviewForToken);
  const patchStartingReviewParentSession = useReviewUiStore(
    (state) => state.patchStartingReviewParentSession,
  );
  const startPlanReviewMutation = useStartPlanReviewMutation({ workspaceId: selectedWorkspaceId });
  const startCodeReviewMutation = useStartCodeReviewMutation({ workspaceId: selectedWorkspaceId });
  const stopReviewMutation = useStopReviewMutation({ workspaceId: selectedWorkspaceId });
  const sendReviewFeedbackMutation = useSendReviewFeedbackMutation({
    workspaceId: selectedWorkspaceId,
  });
  const markReviewRevisionReadyMutation = useMarkReviewRevisionReadyMutation({
    workspaceId: selectedWorkspaceId,
  });
  const retryReviewAssignmentMutation = useRetryReviewAssignmentMutation({
    workspaceId: selectedWorkspaceId,
  });

  const configurePlanReview = useCallback((
    plan: PromptPlanAttachmentDescriptor,
    anchorRect?: ReviewSetupAnchorRect | null,
  ) => {
    const activeId = useSessionSelectionStore.getState().activeSessionId;
    const planSessionSlot = getSessionRecord(plan.sourceSessionId);
    if (!planSessionSlot) {
      showToast("Plan session is not available.");
      return;
    }
    if (activeId !== plan.sourceSessionId) {
      showToast("Select the plan's session before starting plan review.");
      return;
    }
    openReviewSetup({ kind: "plan", plan }, anchorRect);
  }, [openReviewSetup, showToast]);

  const configureCodeReview = useCallback((anchorRect?: ReviewSetupAnchorRect | null) => {
    if (!activeSessionId || !activeSlot) {
      showToast("Start or select a session before requesting code review.");
      return;
    }
    openReviewSetup({ kind: "code", parentSessionId: activeSessionId }, anchorRect);
  }, [activeSessionId, activeSlot, openReviewSetup, showToast]);

  const startPlanReview = useCallback((plan: PromptPlanAttachmentDescriptor) => {
    const activeId = useSessionSelectionStore.getState().activeSessionId;
    const planSessionSlot = getSessionRecord(plan.sourceSessionId);
    if (!planSessionSlot) {
      showToast("Plan session is not available.");
      return;
    }
    if (activeId !== plan.sourceSessionId) {
      showToast("Select the plan's session before starting plan review.");
      return;
    }
    const request = resolveOneClickReviewRequest({
      kind: "plan",
      parentSessionId: plan.sourceSessionId,
      parentSlot: planSessionSlot,
      reviewDefaultsByKind,
      reviewPersonalitiesByKind,
    });
    if (!request.request) {
      showToast(request.error ?? "Review defaults need configuration.");
      openReviewSetup({ kind: "plan", plan }, null);
      return;
    }
    const reviewRequest = request.request;
    const startingReview = buildStartingReview(plan.sourceSessionId, "plan", reviewRequest);
    const startingReviewToken = {
      kind: startingReview.kind,
      startedAt: startingReview.startedAt,
    };
    beginStartingReview(startingReview);
    void (async () => {
      const materializedParentSessionId = await waitForReviewParentSessionMaterialization(
        plan.sourceSessionId,
        sessionMaterializationDeps,
      );
      const materializedRequest = materializeReviewParentSession(
        reviewRequest,
        materializedParentSessionId,
      );
      const didPatchStartingReview = patchStartingReviewParentSession(
        startingReviewToken,
        materializedParentSessionId,
      );
      if (!didPatchStartingReview) {
        return;
      }
      await startPlanReviewMutation.mutateAsync({
        planId: plan.planId,
        request: materializedRequest,
      });
    })().catch((error) => {
      if (clearStartingReviewForToken(startingReviewToken)) {
        showToast(`Failed to start review: ${errorMessage(error)}`);
      }
    });
  }, [
    beginStartingReview,
    clearStartingReviewForToken,
    openReviewSetup,
    patchStartingReviewParentSession,
    reviewDefaultsByKind,
    reviewPersonalitiesByKind,
    showToast,
    startPlanReviewMutation,
  ]);

  const startCodeReview = useCallback(() => {
    if (!activeSessionId || !activeSlot) {
      showToast("Start or select a session before requesting code review.");
      return;
    }
    const request = resolveOneClickReviewRequest({
      kind: "code",
      parentSessionId: activeSessionId,
      parentSlot: activeSlot,
      reviewDefaultsByKind,
      reviewPersonalitiesByKind,
    });
    if (!request.request) {
      showToast(request.error ?? "Review defaults need configuration.");
      openReviewSetup({ kind: "code", parentSessionId: activeSessionId }, null);
      return;
    }
    const reviewRequest = request.request;
    const startingReview = buildStartingReview(activeSessionId, "code", reviewRequest);
    const startingReviewToken = {
      kind: startingReview.kind,
      startedAt: startingReview.startedAt,
    };
    beginStartingReview(startingReview);
    void (async () => {
      const materializedParentSessionId = await waitForReviewParentSessionMaterialization(
        activeSessionId,
        sessionMaterializationDeps,
      );
      const materializedRequest = materializeReviewParentSession(
        reviewRequest,
        materializedParentSessionId,
      );
      const didPatchStartingReview = patchStartingReviewParentSession(
        startingReviewToken,
        materializedParentSessionId,
      );
      if (!didPatchStartingReview) {
        return;
      }
      await startCodeReviewMutation.mutateAsync(materializedRequest);
    })().catch((error) => {
      if (clearStartingReviewForToken(startingReviewToken)) {
        showToast(`Failed to start review: ${errorMessage(error)}`);
      }
    });
  }, [
    activeSessionId,
    activeSlot,
    beginStartingReview,
    clearStartingReviewForToken,
    openReviewSetup,
    patchStartingReviewParentSession,
    reviewDefaultsByKind,
    reviewPersonalitiesByKind,
    showToast,
    startCodeReviewMutation,
  ]);

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

  const retryReviewAssignment = useCallback((reviewRunId: string, assignmentId: string) => {
    void retryReviewAssignmentMutation.mutateAsync({
      reviewRunId,
      assignmentId,
      request: { modelId: "claude-opus-4-6" },
    }).catch((error) => {
      showToast(`Failed to retry reviewer: ${errorMessage(error)}`);
    });
  }, [retryReviewAssignmentMutation, showToast]);

  return {
    startPlanReview,
    configurePlanReview,
    startCodeReview,
    configureCodeReview,
    stopReview,
    sendReviewFeedback,
    markReviewRevisionReady,
    retryReviewAssignment,
    canStartCodeReview: !!activeSessionId && !!activeSlot,
    isStartingReview: startPlanReviewMutation.isPending || startCodeReviewMutation.isPending,
    isStoppingReview: stopReviewMutation.isPending,
    isSendingReviewFeedback: sendReviewFeedbackMutation.isPending,
    isMarkingReviewRevisionReady: markReviewRevisionReadyMutation.isPending,
    isRetryingReviewAssignment: retryReviewAssignmentMutation.isPending,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
