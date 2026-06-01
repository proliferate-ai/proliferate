import type { ReviewRunDetail } from "@anyharness/sdk";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/facade/use-delegated-work-composer";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import type { DelegatedWorkStatusCategory } from "@/lib/domain/delegated-work/model";
import {
  delegatedWorkStatusCategoryFromLabel,
  selectSingleDelegatedAgentTriggerIdentity,
  type DelegatedAgentTriggerCandidate,
} from "@/lib/domain/delegated-work/presentation";
import {
  PLAYGROUND_SUBAGENT_STRIP_ROWS,
  type PlaygroundReviewComposerRow,
  type PlaygroundReviewComposerState,
} from "@/lib/domain/chat/__fixtures__/playground/delegation-fixtures";
import { noop } from "@/components/playground/PlaygroundComposerActions";

export function buildPlaygroundDelegatedWorkViewModel(args: {
  reviewState?: PlaygroundReviewComposerState | null;
  subagentRows?: typeof PLAYGROUND_SUBAGENT_STRIP_ROWS;
}): DelegatedWorkComposerViewModel {
  const reviewRun = args.reviewState
    ? buildPlaygroundReviewRun(args.reviewState)
    : null;
  const subagents = args.subagentRows
    ? {
      rows: args.subagentRows,
      parent: null,
      summary: buildPlaygroundSubagentSummary(args.subagentRows),
      overflowCount: 0,
      openSubagent: noop,
      openParent: noop,
      scheduleWake: noop,
      isSchedulingWake: false,
    }
    : null;
  const summary = args.reviewState
    ? {
      label: args.reviewState.actionLabel === "Send feedback"
        ? "feedback ready"
        : args.reviewState.summary.label,
      active: args.reviewState.summary.active,
    }
    : subagents
      ? {
        label: subagents.summary.detail ?? subagents.summary.label,
        active: subagents.summary.active,
      }
      : { label: "No active work", active: false };
  const visibleAgents: DelegatedAgentTriggerCandidate[] = [
    ...(args.reviewState?.rows.map((row) => ({
      identity: buildDelegatedAgentIdentity({
        id: row.id,
        title: row.label,
        sessionId: `reviewer-session-${row.id}`,
        sessionLinkId: `reviewer-link-${row.id}`,
      }),
      statusCategory: playgroundReviewStatusCategory(row.status),
    })) ?? []),
    ...(subagents?.rows.map((row) => ({
      identity: row.identity,
      statusCategory: row.statusCategory,
    })) ?? []),
  ];

  return {
    summary,
    singleAgent: selectSingleDelegatedAgentTriggerIdentity(visibleAgents),
    review: reviewRun ? {
      run: reviewRun,
      startingReview: null,
      openCritique: noop,
      openReviewerSession: noop,
      stop: noop,
      sendFeedback: noop,
      markRevisionReady: noop,
      retryAssignment: noop,
      dismiss: noop,
    } : null,
    subagents,
  };
}

function playgroundReviewStatusCategory(
  status: PlaygroundReviewComposerRow["status"],
): DelegatedWorkStatusCategory {
  if (status === "Failed") {
    return "failed";
  }
  return delegatedWorkStatusCategoryFromLabel({ statusLabel: status });
}

function buildPlaygroundReviewRun(state: PlaygroundReviewComposerState): ReviewRunDetail {
  const status = state.actionLabel === "Send feedback"
    ? "feedback_ready"
    : state.actionLabel === "Dismiss"
      ? "passed"
      : "reviewing";
  const now = "2026-04-14T00:00:00Z";
  const roundId = "playground-review-round";
  const runId = "playground-review-run";
  const assignments: ReviewRunDetail["rounds"][number]["assignments"] = state.rows.map((row, index) => ({
    id: row.id,
    reviewRunId: runId,
    reviewRoundId: roundId,
    personaId: row.id,
    personaLabel: row.label,
    agentKind: index % 2 === 0 ? "codex" : "claude",
    modelId: index % 2 === 0 ? "gpt-5.4" : "claude-sonnet-4-5",
    requestedModeId: "full-access",
    actualModeId: "full-access",
    modeVerificationStatus: "verified",
    status: playgroundReviewAssignmentStatus(row),
    pass: row.status === "Approved" ? true : row.status === "Requests changes" ? false : null,
    summary: row.detail,
    hasCritique: row.hasCritique,
    critiqueArtifactPath: row.hasCritique ? `/tmp/${row.id}-critique.md` : null,
    reviewerSessionId: `reviewer-session-${row.id}`,
    sessionLinkId: `reviewer-link-${row.id}`,
    deadlineAt: now,
    createdAt: now,
    updatedAt: now,
  }));

  return {
    id: runId,
    workspaceId: "playground-workspace",
    parentSessionId: "playground-parent-session",
    title: state.summary.label,
    kind: state.summary.detail?.toLowerCase().includes("code") ? "code" : "plan",
    targetPlanId: null,
    targetPlanSnapshotHash: null,
    status,
    maxRounds: 2,
    autoIterate: true,
    currentRoundNumber: 1,
    activeRoundId: roundId,
    parentCanSignalRevisionViaMcp: true,
    childSessionIds: assignments
      .map((assignment) => assignment.reviewerSessionId)
      .filter((sessionId): sessionId is string => !!sessionId),
    rounds: [
      {
        id: roundId,
        reviewRunId: runId,
        roundNumber: 1,
        status: status === "feedback_ready" ? "feedback_pending" : status === "passed" ? "passed" : "reviewing",
        targetPlanId: null,
        targetPlanSnapshotHash: null,
        feedbackJobId: null,
        feedbackPromptSentAt: null,
        feedbackDelivery: state.deliveryLabel ? {
          state: status === "feedback_ready" ? "pending" : "sent",
          attemptCount: 0,
          failureReason: null,
          failureDetail: null,
          nextAttemptAt: null,
        } : null,
        failureReason: null,
        failureDetail: null,
        assignments,
        createdAt: now,
        updatedAt: now,
      },
    ],
    failureReason: null,
    failureDetail: null,
    createdAt: now,
    updatedAt: now,
  };
}

function playgroundReviewAssignmentStatus(row: PlaygroundReviewComposerRow) {
  switch (row.status) {
    case "Starting":
      return "launching";
    case "Reviewing":
      return "reviewing";
    case "Requests changes":
    case "Approved":
      return "submitted";
    case "Failed":
      return "system_failed";
  }
}

function buildPlaygroundSubagentSummary(
  rows: typeof PLAYGROUND_SUBAGENT_STRIP_ROWS,
) {
  const workingCount = rows.filter((row) => row.statusLabel === "Working").length;
  const wakeScheduledCount = rows.filter((row) => row.wakeScheduled).length;
  const failedCount = rows.filter((row) => row.statusLabel === "Failed").length;
  const detailParts = [
    workingCount > 0 ? `${workingCount} working` : null,
    wakeScheduledCount > 0 ? `${wakeScheduledCount} wake scheduled` : null,
    failedCount > 0 ? `${failedCount} failed` : null,
  ].filter((part): part is string => part !== null);
  return {
    label: `${rows.length} ${rows.length === 1 ? "subagent" : "subagents"}`,
    detail: detailParts.slice(0, 2).join(" · ") || null,
    active: workingCount > 0 || wakeScheduledCount > 0 || failedCount > 0,
  };
}
