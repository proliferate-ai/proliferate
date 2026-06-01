import type { ReviewAssignmentDetail, ReviewRunDetail } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  FileText,
  RefreshCw,
  Robot,
  StopSquare,
  X,
} from "@proliferate/ui/icons";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/facade/use-delegated-work-composer";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import type { DelegatedAgentIdentity } from "@/lib/domain/delegated-work/model";
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
  detail,
  onClose,
}: {
  review: NonNullable<DelegatedWorkComposerViewModel["review"]>;
  detail?: string | null;
  onClose: () => void;
}) {
  return (
    <PopoverSection title="Reviews" detail={detail}>
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
  const hasActionMessage = !!deliveryLabel || !!failureDisplay;

  return (
    <>
      <div className="space-y-0.5">
        {round?.assignments.map((assignment) => (
          <ReviewAssignmentRow
            key={assignment.id}
            assignment={assignment}
            identity={buildDelegatedAgentIdentity({
              id: assignment.id,
              title: assignment.personaLabel,
              sessionId: assignment.reviewerSessionId ?? null,
              sessionLinkId: assignment.sessionLinkId ?? assignment.id,
            })}
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
        <div className="mt-0.5 flex min-w-0 items-center gap-2 px-1 pt-0.5">
          {deliveryLabel && (
            <div className="min-w-0 truncate text-xs text-muted-foreground">{deliveryLabel}</div>
          )}
          {failureDisplay && (
            <div className="min-w-0 truncate text-xs text-destructive">{failureDisplay}</div>
          )}
          <div className={`${hasActionMessage ? "ml-auto" : ""} flex shrink-0 items-center gap-1`}>
            {run.status === "feedback_ready" && (
              <Button
                type="button"
                size="sm"
                className="h-7 px-2"
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
                className="h-7 px-2"
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
                className="h-7 px-2"
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
                variant="ghost"
                size="sm"
                className="h-7 px-1.5"
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
                className="h-7 px-1.5"
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
  identity,
  onOpenCritique,
  onOpenReviewerSession,
  onRetryAssignment,
}: {
  assignment: ReviewAssignmentDetail;
  identity: DelegatedAgentIdentity;
  onOpenCritique: () => void;
  onOpenReviewerSession: (sessionId: string) => void;
  onRetryAssignment: () => void;
}) {
  const canOpenSession = !!assignment.reviewerSessionId;
  const canRetry = assignment.status === "retryable_failed"
    && assignment.failureReason === "provider_rate_limit";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted/40">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canOpenSession}
        className="h-7 w-full min-w-0 justify-between rounded-md px-1.5 py-0 text-left hover:bg-transparent disabled:cursor-default"
        onClick={() => canOpenSession && onOpenReviewerSession(assignment.reviewerSessionId!)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Robot className={`size-3.5 shrink-0 ${identity.textColorClassName}`} />
          <span className="min-w-0 truncate text-sm text-foreground">
            {identity.displayName}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {reviewAssignmentStatusLabel(assignment)}
        </span>
      </Button>
      {canRetry ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={onRetryAssignment}
        >
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      ) : assignment.hasCritique ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7"
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
    <div className="space-y-0.5">
      {startingReview.reviewers.map((reviewer, index) => {
        const identity = buildDelegatedAgentIdentity({
          id: reviewer.id,
          title: reviewer.label,
        });
        return (
          <div
            key={`${reviewer.id}-${index}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Robot className={`size-3.5 shrink-0 ${identity.textColorClassName}`} />
              <span className="truncate text-sm font-medium text-foreground">
                {identity.displayName}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">Starting</span>
          </div>
        );
      })}
    </div>
  );
}
