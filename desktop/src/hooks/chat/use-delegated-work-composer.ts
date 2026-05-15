import { useEffect, useMemo } from "react";
import type { ReviewAssignmentDetail, ReviewRunDetail } from "@anyharness/sdk";
import { useScheduleSubagentWakeMutation } from "@anyharness/sdk-react";
import { useCoworkComposerStrip } from "@/hooks/cowork/facade/use-cowork-composer-strip";
import { useSubagentComposerStrip } from "@/hooks/chat/subagents/use-subagent-composer-strip";
import { useActiveReviewRun } from "@/hooks/reviews/facade/use-active-review-run";
import { useReviewActions } from "@/hooks/reviews/workflows/use-review-actions";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import {
  deriveDelegatedWorkSummary,
  type DelegatedWorkSummary,
  type DelegatedWorkSummaryCandidate,
} from "@/lib/domain/chat/subagents/delegated-work";
import type { DelegatedAgentIdentity } from "@/lib/domain/delegated-work/model";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import {
  delegatedWorkStatusCategoryFromLabel,
  type DelegatedAgentTriggerCandidate,
  reviewRunStatusCategory,
  selectSingleDelegatedAgentTriggerIdentity,
  shouldShowDelegatedWorkInComposer,
} from "@/lib/domain/delegated-work/presentation";
import {
  latestReviewRound,
  reviewAssignmentStatusLabel,
  reviewKindLabel,
  reviewRunReplacesStartingReview,
} from "@/lib/domain/reviews/review-runs";
import { useReviewUiStore, type StartingReviewState } from "@/stores/reviews/review-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

export interface DelegatedWorkComposerViewModel {
  summary: DelegatedWorkSummary;
  singleAgent: DelegatedAgentIdentity | null;
  review: {
    run: ReviewRunDetail | null;
    startingReview: StartingReviewState | null;
    openCritique: (assignment: ReviewAssignmentDetail) => void;
    openReviewerSession: (sessionId: string) => void;
    stop: (reviewRunId: string) => void;
    sendFeedback: (reviewRunId: string) => void;
    markRevisionReady: (reviewRunId: string) => void;
    retryAssignment: (reviewRunId: string, assignmentId: string) => void;
    dismiss: (reviewRunId: string) => void;
  } | null;
  cowork: ReturnType<typeof useCoworkComposerStrip>;
  subagents: (ReturnType<typeof useSubagentComposerStrip> & {
    scheduleWake: (childSessionId: string) => void;
    isSchedulingWake: boolean;
  }) | null;
}

export function useDelegatedWorkComposer(): DelegatedWorkComposerViewModel | null {
  const activeReviewRun = useActiveReviewRun();
  const reviewActions = useReviewActions();
  const cowork = useCoworkComposerStrip();
  const subagents = useSubagentComposerStrip();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const activeWorkspaceId = useSessionDirectoryStore((state) => (
    activeSessionId ? state.entriesById[activeSessionId]?.workspaceId ?? null : null
  ));
  const { activateChatTab } = useWorkspaceShellActivation();
  const openCritique = useReviewUiStore((state) => state.openCritique);
  const dismissTerminalNotice = useReviewUiStore((state) => state.dismissTerminalNotice);
  const clearStartingReview = useReviewUiStore((state) => state.clearStartingReview);
  const showToast = useToastStore((state) => state.show);
  const scheduleWakeMutation = useScheduleSubagentWakeMutation({
    workspaceId: activeWorkspaceId ?? selectedWorkspaceId,
  });
  const run = activeReviewRun.run;
  const startingReview = activeReviewRun.startingReview;
  const runReplacesStartingReview = run
    ? reviewRunReplacesStartingReview(run, startingReview)
    : false;

  useEffect(() => {
    if (runReplacesStartingReview) {
      clearStartingReview();
    }
  }, [clearStartingReview, runReplacesStartingReview]);

  const review = useMemo<DelegatedWorkComposerViewModel["review"]>(() => {
    const visibleRun = run && (!startingReview || runReplacesStartingReview) ? run : null;
    const visibleStartingReview = visibleRun ? null : startingReview;
    if (visibleRun && !shouldShowReviewRunInComposer(visibleRun)) {
      return null;
    }
    if (!visibleRun && !visibleStartingReview) {
      return null;
    }
    return {
      run: visibleRun,
      startingReview: visibleStartingReview,
      openCritique: (assignment) => {
        if (!visibleRun) return;
        openCritique({
          reviewRunId: visibleRun.id,
          assignmentId: assignment.id,
          personaLabel: assignment.personaLabel,
        });
      },
      openReviewerSession: (sessionId) => {
        if (!selectedWorkspaceId) return;
        void activateChatTab({
          workspaceId: selectedWorkspaceId,
          sessionId,
          source: "delegated-work-composer",
        }).catch((error) => {
          showToast(`Failed to open reviewer session: ${errorMessage(error)}`);
        });
      },
      stop: reviewActions.stopReview,
      sendFeedback: reviewActions.sendReviewFeedback,
      markRevisionReady: reviewActions.markReviewRevisionReady,
      retryAssignment: reviewActions.retryReviewAssignment,
      dismiss: dismissTerminalNotice,
    };
  }, [
    activateChatTab,
    dismissTerminalNotice,
    openCritique,
    reviewActions.markReviewRevisionReady,
    reviewActions.retryReviewAssignment,
    reviewActions.sendReviewFeedback,
    reviewActions.stopReview,
    run,
    runReplacesStartingReview,
    selectedWorkspaceId,
    showToast,
    startingReview,
  ]);

  const subagentModel = useMemo<DelegatedWorkComposerViewModel["subagents"]>(() => {
    if (!subagents) {
      return null;
    }
    const visibleRows = subagents.rows.filter((row) =>
      shouldShowDelegatedWorkInComposer({ statusCategory: row.statusCategory })
    );
    if (visibleRows.length === 0) {
      return null;
    }
    return {
      ...subagents,
      rows: visibleRows,
      isSchedulingWake: scheduleWakeMutation.isPending,
      scheduleWake: (childSessionId) => {
        const parentSessionId = subagents.parent?.parentSessionId ?? activeSessionId;
        if (!parentSessionId) {
          showToast("Select a parent session before scheduling a wake.");
          return;
        }
        void scheduleWakeMutation.mutateAsync({
          sessionId: parentSessionId,
          childSessionId,
        }).catch((error) => {
          showToast(`Failed to schedule wake: ${errorMessage(error)}`);
        });
      },
    };
  }, [activeSessionId, scheduleWakeMutation, showToast, subagents]);

  const coworkModel = useMemo(() => {
    if (!cowork) {
      return null;
    }
    const rows = cowork.rows
      .map((workspace) => ({
        ...workspace,
        sessions: workspace.sessions.filter((session) =>
          shouldShowDelegatedWorkInComposer({ statusCategory: session.statusCategory })
        ),
      }))
      .filter((workspace) => workspace.sessions.length > 0);
    if (rows.length === 0) {
      return null;
    }
    return {
      ...cowork,
      rows,
    };
  }, [cowork]);

  const summary = useMemo(() => deriveDelegatedWorkSummary([
    ...reviewSummaryCandidates(review),
    ...coworkSummaryCandidates(coworkModel),
    ...subagentSummaryCandidates(subagentModel),
  ]), [coworkModel, review, subagentModel]);

  const singleAgent = useMemo(() => {
    const agents = [
      ...reviewVisibleAgents(review, selectedWorkspaceId),
      ...coworkVisibleAgents(coworkModel),
      ...subagentVisibleAgents(subagentModel),
    ];
    return selectSingleDelegatedAgentTriggerIdentity(agents);
  }, [coworkModel, review, selectedWorkspaceId, subagentModel]);

  if (!review && !coworkModel && !subagentModel) {
    return null;
  }

  return {
    summary,
    singleAgent,
    review,
    cowork: coworkModel,
    subagents: subagentModel,
  };
}

function shouldShowReviewRunInComposer(run: ReviewRunDetail): boolean {
  const category = reviewRunStatusCategory(run.status);
  return shouldShowDelegatedWorkInComposer({
    statusCategory: category,
    hasActionNeeded: run.status === "feedback_ready"
      || run.status === "waiting_for_revision"
      || run.status === "system_failed",
  });
}

function reviewSummaryCandidates(
  review: DelegatedWorkComposerViewModel["review"],
): DelegatedWorkSummaryCandidate[] {
  if (!review) return [];
  if (review.startingReview) {
    return [{ priority: "running", label: "starting" }];
  }
  const run = review.run;
  if (!run) return [];
  if (run.status === "feedback_ready" || run.status === "waiting_for_revision") {
    return [{
      priority: "needs_action",
      label: run.status === "feedback_ready" ? "critique ready" : "waiting for revision",
    }];
  }
  if (run.status === "system_failed") {
    return [{ priority: "failed", label: "1 failed" }];
  }
  if (run.status === "reviewing" || run.status === "parent_revising") {
    const reviewerCount = latestReviewRound(run)?.assignments.length || run.childSessionIds.length || 1;
    return [{ priority: "running", label: "running", count: reviewerCount }];
  }
  return [{ priority: "finished", label: "finished" }];
}

function coworkSummaryCandidates(
  cowork: DelegatedWorkComposerViewModel["cowork"],
): DelegatedWorkSummaryCandidate[] {
  if (!cowork) return [];
  const running = cowork.rows.flatMap((row) => row.sessions)
    .filter((session) => session.statusLabel === "Working").length;
  const failed = cowork.rows.flatMap((row) => row.sessions)
    .filter((session) => session.statusLabel === "Failed").length;
  if (failed > 0) return [{ priority: "failed", label: "failed", count: failed }];
  if (running > 0) return [{ priority: "running", label: "running", count: running }];
  return [{ priority: "finished", label: cowork.summary.label }];
}

function subagentSummaryCandidates(
  subagents: DelegatedWorkComposerViewModel["subagents"],
): DelegatedWorkSummaryCandidate[] {
  if (!subagents) return [];
  const failed = subagents.rows.filter((row) => row.statusLabel === "Failed").length;
  const running = subagents.rows.filter((row) => row.statusLabel === "Working").length;
  const wake = subagents.rows.filter((row) => row.wakeScheduled).length;
  if (failed > 0) return [{ priority: "failed", label: "failed", count: failed }];
  if (running > 0) return [{ priority: "running", label: "running", count: running }];
  if (wake > 0) return [{ priority: "wake_scheduled", label: "wake scheduled", count: wake }];
  return [{ priority: "finished", label: subagents.summary.label }];
}

function subagentVisibleAgents(
  subagents: DelegatedWorkComposerViewModel["subagents"],
): DelegatedAgentTriggerCandidate[] {
  return subagents?.rows.map((row) => ({
    identity: row.identity,
    statusCategory: row.statusCategory,
  })) ?? [];
}

function coworkVisibleAgents(
  cowork: DelegatedWorkComposerViewModel["cowork"],
): DelegatedAgentTriggerCandidate[] {
  return cowork?.rows.flatMap((workspace) =>
    workspace.sessions.map((session) => {
      const identity = session.identity;
      const resolvedIdentity = identity.openTarget
        ? {
          ...identity,
          openTarget: {
            ...identity.openTarget,
            workspaceId: workspace.workspaceId,
          },
        }
        : identity;
      return {
        identity: resolvedIdentity,
        statusCategory: session.statusCategory,
      };
    })
  ) ?? [];
}

function reviewVisibleAgents(
  review: DelegatedWorkComposerViewModel["review"],
  workspaceId: string | null,
): DelegatedAgentTriggerCandidate[] {
  if (!review) {
    return [];
  }
  if (review.startingReview) {
    return review.startingReview.reviewers.map((reviewer) => ({
      identity: buildDelegatedAgentIdentity({
        id: reviewer.id,
        title: reviewer.label,
      }),
      statusCategory: "running",
    }));
  }
  const run = review.run;
  if (!run) {
    return [];
  }
  const round = latestReviewRound(run);
  if (!round) {
    return [{
      identity: buildDelegatedAgentIdentity({
        id: run.id,
        title: reviewKindLabel(run.kind),
        workspaceId,
        sessionId: run.parentSessionId,
        sessionLinkId: run.id,
      }),
      statusCategory: reviewRunStatusCategory(run.status),
    }];
  }
  return round.assignments
    .map((assignment) => ({
      assignment,
      statusCategory: delegatedWorkStatusCategoryFromLabel({
        statusLabel: reviewAssignmentStatusLabel(assignment),
      }),
    }))
    .filter(({ assignment, statusCategory }) => shouldShowDelegatedWorkInComposer({
      statusCategory,
      hasActionNeeded: assignment.status === "retryable_failed"
        || assignment.status === "system_failed"
        || assignment.status === "timed_out",
    }))
    .map(({ assignment, statusCategory }) => ({
      identity: buildDelegatedAgentIdentity({
        id: assignment.id,
        title: assignment.personaLabel || reviewKindLabel(run.kind),
        workspaceId,
        sessionId: assignment.reviewerSessionId ?? null,
        sessionLinkId: assignment.sessionLinkId ?? assignment.id,
      }),
      statusCategory,
    }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
