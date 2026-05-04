import type { ReviewAssignmentDetail, ReviewRunDetail } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import {
  FileText,
  RefreshCw,
  StopSquare,
  X,
} from "@/components/ui/icons";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/use-delegated-work-composer";
import {
  latestReviewRound,
  reviewAssignmentStatusLabel,
  reviewFeedbackDeliveryLabel,
  reviewRunFailureDisplay,
  reviewRunHasNextRound,
} from "@/lib/domain/reviews/review-runs";
import type { StartingReviewState } from "@/stores/reviews/review-ui-store";
import { PopoverSection } from "./PopoverSection";

export function AgentsPopoverReviewSection({
  review,
  onClose,
}: {
  review: NonNullable<DelegatedWorkComposerViewModel["review"]>;
  onClose: () => void;
}) {
  return (
    <PopoverSection title="Reviews">
      {review.run ? (
        <ReviewRunRows run={review.run} review={review} onClose={onClose} />
      ) : review.startingReview ? (
        <StartingReviewRows startingReview={review.startingReview} />
      ) : null}
    </PopoverSection>
  );
}

function ReviewRunRows({
  run,
  review,
  onClose,
}: {
  run: ReviewRunDetail;
  review: NonNullable<DelegatedWorkComposerViewModel["review"]>;
  onClose: () => void;
}) {
  const round = latestReviewRound(run);
  const deliveryLabel = round?.feedbackDelivery
    ? reviewFeedbackDeliveryLabel(round.feedbackDelivery)
    : null;
  const failureDisplay = reviewRunFailureDisplay(run);
  const isTerminal = run.status === "passed"
    || run.status === "stopped"
    || run.status === "system_failed";
  const hasNextRound = reviewRunHasNextRound(run);
  const canReviewRevision = run.status === "waiting_for_revision" && hasNextRound;
  const canFinishReview = run.status === "waiting_for_revision" && !hasNextRound;
  const canStop = !isTerminal && run.status !== "waiting_for_revision";

  return (
    <>
      <div className="space-y-1">
        {round?.assignments.map((assignment) => (
          <ReviewAssignmentRow
            key={assignment.id}
            assignment={assignment}
            onOpenCritique={() => {
              review.openCritique(assignment);
              onClose();
            }}
            onOpenReviewerSession={(sessionId) => {
              review.openReviewerSession(sessionId);
              onClose();
            }}
            onRetryAssignment={() => review.retryAssignment(run.id, assignment.id)}
          />
        ))}
      </div>
      {(
        deliveryLabel
        || failureDisplay
        || run.status === "feedback_ready"
        || canReviewRevision
        || canFinishReview
        || canStop
        || isTerminal
      ) && (
        <div className="mt-2 border-t border-border/60 pt-2">
          {deliveryLabel && (
            <div className="mb-2 text-xs text-muted-foreground">{deliveryLabel}</div>
          )}
          {failureDisplay && (
            <div className="mb-2 text-xs text-destructive">{failureDisplay}</div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {run.status === "feedback_ready" && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  review.sendFeedback(run.id);
                  onClose();
                }}
              >
                Send feedback
              </Button>
            )}
            {canReviewRevision && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  review.markRevisionReady(run.id);
                  onClose();
                }}
              >
                Review revision
              </Button>
            )}
            {canFinishReview && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  review.stop(run.id);
                  onClose();
                }}
              >
                Finish review
              </Button>
            )}
            {canStop && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  review.stop(run.id);
                  onClose();
                }}
              >
                <StopSquare className="size-3.5" />
                Stop
              </Button>
            )}
            {isTerminal && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  review.dismiss(run.id);
                  onClose();
                }}
              >
                <X className="size-3.5" />
                Dismiss
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ReviewAssignmentRow({
  assignment,
  onOpenCritique,
  onOpenReviewerSession,
  onRetryAssignment,
}: {
  assignment: ReviewAssignmentDetail;
  onOpenCritique: () => void;
  onOpenReviewerSession: (sessionId: string) => void;
  onRetryAssignment: () => void;
}) {
  const canOpenSession = !!assignment.reviewerSessionId;
  const canRetry = assignment.status === "retryable_failed"
    && assignment.failureReason === "provider_rate_limit";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg px-2 py-2 hover:bg-muted/40">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canOpenSession}
        className="h-auto min-w-0 flex-col items-start gap-0 whitespace-normal rounded-md px-0 py-0 text-left hover:bg-transparent disabled:cursor-default"
        onClick={() => canOpenSession && onOpenReviewerSession(assignment.reviewerSessionId!)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {assignment.personaLabel}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {reviewAssignmentStatusLabel(assignment)}
          </span>
        </span>
        {assignment.summary && (
          <span className="block truncate text-xs text-muted-foreground">
            {assignment.summary}
          </span>
        )}
      </Button>
      {canRetry ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetryAssignment}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      ) : assignment.hasCritique ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Open critique"
          onClick={onOpenCritique}
        >
          <FileText className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function StartingReviewRows({ startingReview }: { startingReview: StartingReviewState }) {
  return (
    <div className="space-y-1">
      {startingReview.reviewers.map((reviewer, index) => (
        <div
          key={`${reviewer.id}-${index}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2"
        >
          <span className="truncate text-sm font-medium text-foreground">{reviewer.label}</span>
          <span className="text-xs text-muted-foreground">Starting</span>
        </div>
      ))}
    </div>
  );
}
