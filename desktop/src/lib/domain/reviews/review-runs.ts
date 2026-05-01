import type {
  ReviewAssignmentDetail,
  ReviewFeedbackDeliveryDetail,
  ReviewKind,
  ReviewRoundDetail,
  ReviewRunDetail,
  ReviewRunStatus,
} from "@anyharness/sdk";

const SHOWABLE_REVIEW_STATUSES = new Set<ReviewRunStatus>([
  "reviewing",
  "feedback_ready",
  "parent_revising",
  "waiting_for_revision",
  "passed",
  "stopped",
  "system_failed",
]);

export function isReviewRunShowable(run: ReviewRunDetail): boolean {
  return SHOWABLE_REVIEW_STATUSES.has(run.status);
}

export function isReviewRunBusy(run: ReviewRunDetail): boolean {
  if (run.status === "parent_revising") {
    return true;
  }
  if (run.status !== "reviewing") {
    return false;
  }
  const round = latestReviewRound(run);
  return round?.assignments.some((assignment) =>
    assignment.status === "queued"
    || assignment.status === "launching"
    || assignment.status === "reviewing"
    || assignment.status === "reminded"
  ) ?? false;
}

export function isReviewRunTerminal(run: ReviewRunDetail): boolean {
  return run.status === "passed" || run.status === "stopped" || run.status === "system_failed";
}

export function latestReviewRound(run: ReviewRunDetail): ReviewRoundDetail | null {
  if (run.activeRoundId) {
    const active = run.rounds.find((round) => round.id === run.activeRoundId);
    if (active) return active;
  }
  return run.rounds.length > 0 ? run.rounds[run.rounds.length - 1] : null;
}

export function reviewRunStatusLabel(status: ReviewRunStatus): string {
  switch (status) {
    case "reviewing":
      return "Reviewers running";
    case "feedback_ready":
      return "Feedback ready";
    case "parent_revising":
      return "Parent revising";
    case "waiting_for_revision":
      return "Waiting for revision";
    case "passed":
      return "Passed";
    case "stopped":
      return "Stopped";
    case "system_failed":
      return "Failed";
  }
}

export function reviewRunDetailStatusLabel(run: ReviewRunDetail): string {
  if (run.status === "stopped" && run.failureReason === "max_rounds_reached") {
    return "Review complete";
  }
  return reviewRunStatusLabel(run.status);
}

export function reviewRunFailureDisplay(run: ReviewRunDetail): string | null {
  if (run.status === "stopped" && run.failureReason === "max_rounds_reached") {
    return null;
  }
  return run.failureDetail?.trim() || null;
}

export function reviewRunHasNextRound(run: ReviewRunDetail): boolean {
  return run.currentRoundNumber < run.maxRounds;
}

export function reviewKindLabel(kind: ReviewKind): string {
  return kind === "plan" ? "Plan review" : "Code review";
}

export function reviewRoundProgress(assignments: readonly ReviewAssignmentDetail[]): {
  submitted: number;
  total: number;
  failed: number;
} {
  return {
    submitted: assignments.filter((assignment) => assignment.status === "submitted").length,
    failed: assignments.filter((assignment) =>
      assignment.status === "system_failed"
      || assignment.status === "timed_out"
      || assignment.status === "retryable_failed"
    ).length,
    total: assignments.length,
  };
}

export function reviewFeedbackDeliveryLabel(
  delivery: ReviewFeedbackDeliveryDetail,
): string {
  switch (delivery.state) {
    case "pending":
      return delivery.attemptCount > 0 ? "Feedback delivery retry pending" : "Feedback queued";
    case "sending":
      return "Sending feedback";
    case "sent":
      return "Feedback sent";
    case "failed":
      return delivery.failureReason
        ? `Feedback delivery failed: ${delivery.failureReason}`
        : "Feedback delivery failed";
  }
  return "Feedback delivery pending";
}

export function reviewAssignmentStatusLabel(assignment: ReviewAssignmentDetail): string {
  if (assignment.status === "submitted") {
    return assignment.pass ? "Passed" : "Changes";
  }
  switch (assignment.status) {
    case "queued":
    case "launching":
      return "Starting";
    case "reviewing":
    case "reminded":
      return "Reviewing";
    case "retryable_failed":
      return "Needs retry";
    case "cancelled":
      return "Cancelled";
    case "timed_out":
      return "Timed out";
    case "system_failed":
      return "Failed";
  }
}

export function reviewAssignmentHeaderStatusLabel(assignment: ReviewAssignmentDetail): string {
  switch (assignment.status) {
    case "queued":
    case "launching":
      return "Starting";
    case "reviewing":
    case "reminded":
      return "Working";
    case "retryable_failed":
      return "Needs retry";
    case "submitted":
      return "Done";
    case "cancelled":
      return "Cancelled";
    case "timed_out":
      return "Timed out";
    case "system_failed":
      return "Failed";
  }
}
