import type { ReviewAssignmentDetail } from "@anyharness/sdk";
import { useSessionReviewsQuery } from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import { FileText } from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import type { ReviewFeedbackPromptReference } from "@/lib/domain/chat/subagents/provenance";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";

interface ReviewFeedbackSummaryProps {
  reference: ReviewFeedbackPromptReference;
  sessionId: string | null;
  state?: "queued" | "completed";
}

export function ReviewFeedbackSummary({
  reference,
  sessionId,
  state = "completed",
}: ReviewFeedbackSummaryProps) {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const openCritique = useReviewUiStore((state) => state.openCritique);
  const reviewsQuery = useSessionReviewsQuery(sessionId, {
    workspaceId: selectedWorkspaceId,
    enabled: !!sessionId,
    refetchInterval: 5000,
  });
  const run = reviewsQuery.data?.reviews.find((candidate) =>
    candidate.id === reference.reviewRunId
  ) ?? null;
  const round = run?.rounds.find((candidate) =>
    candidate.id === reference.reviewRoundId
    || candidate.feedbackJobId === reference.feedbackJobId
    || candidate.roundNumber === reference.roundNumber
  ) ?? null;
  const assignments = round?.assignments ?? [];
  const target = run?.kind === "code" ? "PR" : "plan";

  return (
    <ReviewFeedbackSummaryView
      assignments={assignments}
      referenceLabel={reference.label}
      reviewRunId={reference.reviewRunId}
      state={state}
      target={target}
      onOpenCritique={(assignment) => {
        openCritique({
          reviewRunId: reference.reviewRunId,
          assignmentId: assignment.id,
          personaLabel: assignment.personaLabel,
        });
      }}
    />
  );
}

export function ReviewFeedbackSummaryView({
  assignments,
  referenceLabel,
  reviewRunId,
  state = "completed",
  target,
  onOpenCritique,
}: {
  assignments: ReviewAssignmentDetail[];
  referenceLabel?: string | null;
  reviewRunId: string;
  state?: "queued" | "completed";
  target: "plan" | "PR";
  onOpenCritique: (assignment: ReviewAssignmentDetail) => void;
}) {
  const receipt = reviewFeedbackReceipt(assignments, target, state, referenceLabel);
  return (
    <div className="flex justify-end">
      <div
        className="grid max-w-[77%] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl bg-foreground/5 px-3 py-2 text-foreground"
        data-telemetry-mask
      >
        <div className="min-w-0 text-chat leading-[var(--text-chat--line-height)]">
          <div className="truncate font-medium">{receipt.title}</div>
          <div className="truncate text-muted-foreground">{receipt.detail}</div>
        </div>
        <PopoverButton
          side="top"
          align="end"
          offset={6}
          stopPropagation
          className="w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-floating"
          trigger={(
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-chat-transcript-ignore
              aria-label="Open review feedback details"
              title="Open review feedback details"
              className="h-7 shrink-0 px-2"
            >
              <FileText className="size-3.5" />
              Details
            </Button>
          )}
        >
          {() => (
            <ReviewFeedbackDetails
              assignments={assignments}
              detail={receipt.detail}
              reviewRunId={reviewRunId}
              title={receipt.title}
              onOpenCritique={onOpenCritique}
            />
          )}
        </PopoverButton>
      </div>
    </div>
  );
}

function ReviewFeedbackDetails({
  assignments,
  detail,
  reviewRunId,
  title,
  onOpenCritique,
}: {
  assignments: ReviewAssignmentDetail[];
  detail: string;
  reviewRunId: string;
  title: string;
  onOpenCritique: (assignment: ReviewAssignmentDetail) => void;
}) {
  return (
    <div data-telemetry-mask>
      <div className="border-b border-border/60 px-3 py-2">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <div className="max-h-80 overflow-y-auto p-1">
        {assignments.length > 0 ? assignments.map((assignment) => (
          <ReviewFeedbackAssignmentRow
            key={assignment.id}
            assignment={assignment}
            reviewRunId={reviewRunId}
            onOpenCritique={() => onOpenCritique(assignment)}
          />
        )) : (
          <div className="px-2 py-2 text-sm text-muted-foreground">
            Loading reviewer results...
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewFeedbackAssignmentRow({
  assignment,
  reviewRunId,
  onOpenCritique,
}: {
  assignment: ReviewAssignmentDetail;
  reviewRunId: string;
  onOpenCritique: () => void;
}) {
  const verdict = reviewAssignmentVerdict(assignment);
  const verdictClassName = verdict.tone === "approved"
    ? "text-foreground"
    : assignment.status === "submitted"
      || assignment.status === "system_failed"
      || assignment.status === "timed_out"
      || assignment.status === "retryable_failed"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 text-left">
      <div className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">
          {assignment.personaLabel || reviewRunId}
        </span>
        {assignment.summary?.trim() && (
          <span className="block truncate text-xs text-muted-foreground">
            {assignment.summary.trim()}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={`text-xs ${verdictClassName}`}>{verdict.label}</span>
        {assignment.hasCritique && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-chat-transcript-ignore
            aria-label={`Open ${assignment.personaLabel} critique`}
            title={`Open ${assignment.personaLabel} critique`}
            onClick={onOpenCritique}
          >
            <FileText className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function reviewFeedbackReceipt(
  assignments: ReviewAssignmentDetail[],
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
  const pendingCount = Math.max(0, reviewerCount - approvedCount - changesCount - failedCount);
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
    pendingCount > 0 ? `${pendingCount} reviewing` : null,
    approvedCount > 0 ? `${approvedCount} approved` : null,
  ].filter((part): part is string => part !== null);

  return {
    title: "Review feedback",
    detail: `${reviewerLabel} · ${detailParts.join(" · ") || "ready"} · ${target}`,
  };
}

function reviewAssignmentVerdict(assignment: ReviewAssignmentDetail): {
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
  return { label: "Reviewing", tone: "pending" };
}
