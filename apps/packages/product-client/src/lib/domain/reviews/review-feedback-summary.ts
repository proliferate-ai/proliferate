import type { ReviewAssignmentDetail } from "@anyharness/sdk";

export function reviewTerminalSummary(
  assignments: readonly ReviewAssignmentDetail[],
): string | null {
  const reviewerCount = assignments.length;
  const approvedCount = assignments.filter((assignment) =>
    assignment.status === "submitted" && assignment.pass
  ).length;
  const changesCount = assignments.filter((assignment) =>
    assignment.status === "submitted" && !assignment.pass
  ).length;
  const timedOutCount = assignments.filter((assignment) =>
    assignment.status === "timed_out"
  ).length;
  const cancelledCount = assignments.filter((assignment) =>
    assignment.status === "cancelled"
  ).length;
  const failedCount = assignments.filter((assignment) =>
    assignment.status === "system_failed" || assignment.status === "retryable_failed"
  ).length;
  const pendingCount = Math.max(
    0,
    reviewerCount - approvedCount - changesCount - timedOutCount - cancelledCount - failedCount,
  );

  if (reviewerCount > 0 && approvedCount === reviewerCount) {
    return null;
  }

  const parts = [
    changesCount > 0
      ? `${changesCount} requested ${changesCount === 1 ? "change" : "changes"}`
      : null,
    failedCount > 0 ? `${failedCount} failed` : null,
    timedOutCount > 0 ? `${timedOutCount} timed out` : null,
    cancelledCount > 0 ? `${cancelledCount} cancelled` : null,
    approvedCount > 0 ? `${approvedCount} approved` : null,
    pendingCount > 0 ? `${pendingCount} still reviewing` : null,
  ].filter((part): part is string => part !== null);

  return parts.join(", ") || null;
}

export function reviewFeedbackReceipt(
  assignments: readonly ReviewAssignmentDetail[],
  target: "plan" | "PR",
  state: "queued" | "completed",
  referenceLabel: string | null | undefined,
): {
  title: string;
  detail: string;
} {
  const reviewerCount = assignments.length;
  if (reviewerCount <= 0) {
    return {
      title: referenceLabel?.toLowerCase().includes("complete") ? "Review complete" : "Review feedback",
      detail: state === "queued" ? "Sending to parent" : "Loading reviewer results",
    };
  }

  const approvedCount = assignments.filter((assignment) =>
    assignment.status === "submitted" && assignment.pass
  ).length;
  const changesCount = assignments.filter((assignment) =>
    assignment.status === "submitted" && !assignment.pass
  ).length;
  const failedCount = assignments.filter((assignment) =>
    assignment.status === "system_failed"
    || assignment.status === "timed_out"
    || assignment.status === "retryable_failed"
  ).length;
  const cancelledCount = assignments.filter((assignment) => assignment.status === "cancelled").length;
  const pendingCount = Math.max(
    0,
    reviewerCount - approvedCount - changesCount - failedCount - cancelledCount,
  );
  const reviewerLabel = `${reviewerCount} ${reviewerCount === 1 ? "reviewer" : "reviewers"}`;

  if (approvedCount === reviewerCount) {
    return {
      title: "Review complete",
      detail: `${reviewerLabel} approved · ${target}`,
    };
  }

  const detailParts = [
    changesCount > 0 ? `${changesCount} requested ${changesCount === 1 ? "change" : "changes"}` : null,
    failedCount > 0 ? `${failedCount} failed` : null,
    cancelledCount > 0 ? `${cancelledCount} cancelled` : null,
    pendingCount > 0 ? `${pendingCount} reviewing` : null,
    approvedCount > 0 ? `${approvedCount} approved` : null,
  ].filter((part): part is string => part !== null);

  return {
    title: "Review feedback",
    detail: `${reviewerLabel} · ${detailParts.join(" · ") || "ready"} · ${target}`,
  };
}

export function reviewAssignmentVerdict(assignment: ReviewAssignmentDetail): {
  label: string;
  tone: "approved" | "changes" | "pending";
} {
  if (assignment.status === "submitted") {
    return assignment.pass
      ? { label: "Approved", tone: "approved" }
      : { label: "Requests changes", tone: "changes" };
  }
  if (assignment.status === "timed_out") {
    return { label: "Timed out", tone: "changes" };
  }
  if (assignment.status === "system_failed") {
    return { label: "Failed", tone: "changes" };
  }
  if (assignment.status === "retryable_failed") {
    return { label: "Needs retry", tone: "changes" };
  }
  if (assignment.status === "cancelled") {
    return { label: "Cancelled", tone: "pending" };
  }
  return { label: "Reviewing", tone: "pending" };
}
