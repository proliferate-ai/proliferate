import { useEffect, type ReactNode } from "react";
import type { ReviewAssignmentDetail, ReviewRunDetail } from "@anyharness/sdk";
import { getProviderDisplayName } from "@/config/providers";
import { Button } from "@/components/ui/Button";
import {
  AgentGlyph,
  CheckCircleFilled,
  CircleAlert,
  FileText,
  RefreshCw,
  StopSquare,
  X,
} from "@/components/ui/icons";
import { DelegatedWorkComposerPanel } from "@/components/workspace/chat/input/DelegatedWorkComposerPanel";
import {
  ReviewComposerControl,
  type ReviewComposerSummary,
} from "@/components/workspace/chat/input/ReviewComposerControl";
import { useActiveReviewRun } from "@/hooks/reviews/use-active-review-run";
import { useReviewActions } from "@/hooks/reviews/use-review-actions";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { resolveSubagentColor } from "@/lib/domain/chat/subagent-braille-color";
import {
  latestReviewRound,
  reviewAssignmentStatusLabel,
  reviewFeedbackDeliveryLabel,
  reviewRunDetailStatusLabel,
  reviewRunFailureDisplay,
  reviewRunHasNextRound,
  reviewKindLabel,
  reviewRoundProgress,
  reviewRunReplacesStartingReview,
} from "@/lib/domain/reviews/review-runs";
import {
  type StartingReviewState,
  useReviewUiStore,
} from "@/stores/reviews/review-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function ConnectedComposerReviewRunPanel() {
  return <ConnectedComposerReviewRunSurface panel />;
}

export function ConnectedComposerReviewRunControl() {
  return <ConnectedComposerReviewRunSurface />;
}

function ConnectedComposerReviewRunSurface({ panel = false }: { panel?: boolean }) {
  const { run, startingReview } = useActiveReviewRun();
  const actions = useReviewActions();
  const { activateChatTab } = useWorkspaceShellActivation();
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const openCritique = useReviewUiStore((state) => state.openCritique);
  const dismissTerminalNotice = useReviewUiStore((state) => state.dismissTerminalNotice);
  const clearStartingReview = useReviewUiStore((state) => state.clearStartingReview);
  const showToast = useToastStore((state) => state.show);
  const runReplacesStartingReview = run
    ? reviewRunReplacesStartingReview(run, startingReview)
    : false;

  useEffect(() => {
    if (runReplacesStartingReview) {
      clearStartingReview();
    }
  }, [clearStartingReview, runReplacesStartingReview]);

  const handleOpenCritique = (assignment: ReviewAssignmentDetail) => {
    if (!run) {
      return;
    }
    openCritique({
      reviewRunId: run.id,
      assignmentId: assignment.id,
      personaLabel: assignment.personaLabel,
    });
  };
  const handleOpenReviewerSession = (sessionId: string) => {
    if (!selectedWorkspaceId) return;
    void activateChatTab({
      workspaceId: selectedWorkspaceId,
      sessionId,
      source: "composer-review-run-panel",
    }).catch((error) => {
      showToast(`Failed to open reviewer session: ${errorMessage(error)}`);
    });
  };

  if (run && (!startingReview || runReplacesStartingReview)) {
    const control = (
      <ReviewComposerControl
        summary={summaryForRun(run)}
        icon={iconForRun(run)}
        active={run.status !== "passed" && run.status !== "stopped"}
      >
        {(close) => (
          <RunReviewPopoverContent
            run={run}
            onStop={() => {
              actions.stopReview(run.id);
              close();
            }}
            onSendFeedback={() => {
              actions.sendReviewFeedback(run.id);
              close();
            }}
            onReviewRevision={() => {
              actions.markReviewRevisionReady(run.id);
              close();
            }}
            onFinishReview={() => {
              actions.stopReview(run.id);
              close();
            }}
            onOpenCritique={(assignment) => {
              handleOpenCritique(assignment);
              close();
            }}
            onOpenReviewerSession={(sessionId) => {
              handleOpenReviewerSession(sessionId);
              close();
            }}
            onRetryAssignment={(assignmentId) => {
              actions.retryReviewAssignment(run.id, assignmentId);
            }}
            onDismiss={() => {
              dismissTerminalNotice(run.id);
              close();
            }}
            isStopping={actions.isStoppingReview}
            isSendingFeedback={actions.isSendingReviewFeedback}
            isReviewingRevision={actions.isMarkingReviewRevisionReady}
            isRetryingAssignment={actions.isRetryingReviewAssignment}
          />
        )}
      </ReviewComposerControl>
    );
    return renderReviewControl(control, panel);
  }

  if (startingReview) {
    const control = (
      <ReviewComposerControl
        summary={summaryForStartingReview(startingReview)}
        icon={iconForStartingReview(startingReview)}
        active
      >
        {() => <StartingReviewPopoverContent startingReview={startingReview} />}
      </ReviewComposerControl>
    );
    return renderReviewControl(control, panel);
  }

  return null;
}

function renderReviewControl(control: ReactNode, panel: boolean) {
  return panel ? (
    <DelegatedWorkComposerPanel>{control}</DelegatedWorkComposerPanel>
  ) : control;
}

function RunReviewPopoverContent({
  run,
  onStop,
  onSendFeedback,
  onReviewRevision,
  onFinishReview,
  onOpenCritique,
  onOpenReviewerSession,
  onRetryAssignment,
  onDismiss,
  isStopping,
  isSendingFeedback,
  isReviewingRevision,
  isRetryingAssignment,
}: {
  run: ReviewRunDetail;
  onStop: () => void;
  onSendFeedback: () => void;
  onReviewRevision: () => void;
  onFinishReview: () => void;
  onOpenCritique: (assignment: ReviewAssignmentDetail) => void;
  onOpenReviewerSession: (sessionId: string) => void;
  onRetryAssignment: (assignmentId: string) => void;
  onDismiss: () => void;
  isStopping: boolean;
  isSendingFeedback: boolean;
  isReviewingRevision: boolean;
  isRetryingAssignment: boolean;
}) {
  const summary = summaryForRun(run);
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
      <div className="border-b border-border px-3 py-2">
        <div className="text-sm font-medium text-foreground">{summary.label}</div>
        {summary.detail && (
          <div className="text-xs text-muted-foreground">{summary.detail}</div>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto p-1">
        {round?.assignments.map((assignment) => (
          <ReviewAssignmentPopoverRow
            key={assignment.id}
            assignment={assignment}
            onOpenCritique={() => onOpenCritique(assignment)}
            onOpenReviewerSession={onOpenReviewerSession}
            onRetryAssignment={() => onRetryAssignment(assignment.id)}
            isRetrying={isRetryingAssignment}
          />
        ))}
      </div>

      {(deliveryLabel || failureDisplay || run.status === "feedback_ready" || canReviewRevision || canFinishReview || canStop || isTerminal) && (
        <div className="border-t border-border px-3 py-2">
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
                variant="primary"
                size="sm"
                loading={isSendingFeedback}
                onClick={onSendFeedback}
                className="px-2.5 text-sm"
              >
                Send feedback
              </Button>
            )}
            {canReviewRevision && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={isReviewingRevision}
                onClick={onReviewRevision}
                className="px-2.5 text-sm"
              >
                Review revision
              </Button>
            )}
            {canFinishReview && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={isStopping}
                onClick={onFinishReview}
                className="px-2.5 text-sm"
              >
                Finish review
              </Button>
            )}
            {canStop && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={isStopping}
                onClick={onStop}
                className="px-2.5 text-sm"
              >
                <StopSquare className="size-3.5" />
                Stop review
              </Button>
            )}
            {isTerminal && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                className="px-2.5 text-sm"
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

function ReviewAssignmentPopoverRow({
  assignment,
  onOpenCritique,
  onOpenReviewerSession,
  onRetryAssignment,
  isRetrying,
}: {
  assignment: ReviewAssignmentDetail;
  onOpenCritique: () => void;
  onOpenReviewerSession: (sessionId: string) => void;
  onRetryAssignment: () => void;
  isRetrying: boolean;
}) {
  const color = resolveSubagentColor(assignment.sessionLinkId ?? assignment.id);
  const secondaryText = assignmentSecondaryText(assignment) ?? formatAssignmentHarness(assignment);
  const canOpenSession = !!assignment.reviewerSessionId;
  const canRetry = assignment.status === "retryable_failed"
    && assignment.failureReason === "provider_rate_limit";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
      {canOpenSession ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-w-0 justify-start gap-2 rounded-lg px-2 py-2 text-left"
          title={`Open ${assignment.personaLabel} session`}
          onClick={() => onOpenReviewerSession(assignment.reviewerSessionId!)}
        >
          <AgentGlyph agentKind={assignment.agentKind} color={color} className="size-5 shrink-0" />
          <AssignmentRowText assignment={assignment} secondaryText={secondaryText} />
        </Button>
      ) : (
        <div className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left">
          <AgentGlyph agentKind={assignment.agentKind} color={color} className="size-5 shrink-0" />
          <AssignmentRowText assignment={assignment} secondaryText={secondaryText} />
        </div>
      )}
      {canRetry ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={isRetrying}
          onClick={onRetryAssignment}
          className="px-2.5 text-sm"
        >
          <RefreshCw className="size-3.5" />
          Retry with Opus 4.6
        </Button>
      ) : assignment.hasCritique && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Open ${assignment.personaLabel} critique`}
          title={`Open ${assignment.personaLabel} critique`}
          onClick={onOpenCritique}
          className="h-8 w-8 rounded-full px-0"
        >
          <FileText className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function AssignmentRowText({
  assignment,
  secondaryText,
}: {
  assignment: ReviewAssignmentDetail;
  secondaryText: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="block min-w-0 truncate text-sm font-medium text-foreground">
          {assignment.personaLabel}
        </span>
        <ComposerAssignmentStatus assignment={assignment} />
      </span>
      <span className="block truncate text-xs text-muted-foreground">
        {secondaryText}
      </span>
    </span>
  );
}

function StartingReviewPopoverContent({ startingReview }: { startingReview: StartingReviewState }) {
  const summary = summaryForStartingReview(startingReview);

  return (
    <>
      <div className="border-b border-border px-3 py-2">
        <div className="text-sm font-medium text-foreground">{summary.label}</div>
        {summary.detail && (
          <div className="text-xs text-muted-foreground">{summary.detail}</div>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto p-1">
        {startingReview.reviewers.map((reviewer, index) => (
          <div
            key={`${reviewer.id}-${index}`}
            className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left"
          >
            <AgentGlyph
              agentKind={reviewer.agentKind}
              color={resolveSubagentColor(`${reviewer.id}-${index}`)}
              className="size-5 shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {reviewer.label}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {formatReviewerHarness(reviewer)}
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5" />
              Starting
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function ComposerAssignmentStatus({ assignment }: { assignment: ReviewAssignmentDetail }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-xs ${assignmentStatusClassName(assignment)}`}
    >
      {assignment.status === "submitted" && assignment.pass ? (
        <CheckCircleFilled className="size-3.5" />
      ) : assignment.status === "submitted"
        || assignment.status === "system_failed"
        || assignment.status === "timed_out"
        || assignment.status === "retryable_failed" ? (
          <CircleAlert className="size-3.5" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
      <span>{composerAssignmentStatusLabel(assignment)}</span>
    </span>
  );
}

function summaryForRun(run: ReviewRunDetail): ReviewComposerSummary {
  const round = latestReviewRound(run);
  const progress = round ? reviewRoundProgress(round.assignments) : null;
  const reviewerCount = round?.assignments.length || run.childSessionIds.length || 0;
  const targetLabel = run.kind === "plan" ? "plan" : "code";
  const reviewerLabel = `${reviewerCount || "Review"} ${reviewerCount === 1 ? "agent" : "agents"}`;
  const progressLabel = progress
    ? `${progress.submitted}/${progress.total}`
    : null;
  const statusLabel = reviewRunDetailStatusLabel(run);

  switch (run.status) {
    case "reviewing":
      return {
        label: run.currentRoundNumber > 1
          ? "Reviewing revision"
          : `${reviewerLabel} reviewing ${targetLabel}`,
        detail: progressLabel ? `${reviewKindLabel(run.kind)} · ${progressLabel}` : reviewKindLabel(run.kind),
      };
    case "feedback_ready":
      return {
        label: `${reviewerLabel} critiqued ${targetLabel}`,
        detail: progressLabel ? `Feedback ready · ${progressLabel}` : "Feedback ready",
      };
    case "parent_revising":
      return {
        label: "Parent revising",
        detail: reviewKindLabel(run.kind),
      };
    case "waiting_for_revision":
      return {
        label: reviewRunHasNextRound(run) ? "Waiting for revision" : "Ready to finish",
        detail: reviewRunHasNextRound(run) ? "Waiting for revision" : "Ready to finish",
      };
    case "passed":
      return {
        label: `${reviewerLabel} approved ${targetLabel}`,
        detail: progressLabel ? `Passed · ${progressLabel}` : "Passed",
      };
    case "system_failed":
      return {
        label: `${reviewKindLabel(run.kind)} failed`,
        detail: run.failureReason ? humanizeFailureReason(run.failureReason) : statusLabel,
      };
    case "stopped":
      if (run.failureReason === "max_rounds_reached") {
        return {
          label: `${reviewKindLabel(run.kind)} complete`,
          detail: "Configured rounds finished",
        };
      }
      return {
        label: `${reviewKindLabel(run.kind)} stopped`,
        detail: statusLabel,
      };
  }
}

function summaryForStartingReview(startingReview: StartingReviewState): ReviewComposerSummary {
  const reviewerCount = startingReview.reviewers.length;
  return {
    label: `${reviewerCount} ${reviewerCount === 1 ? "agent" : "agents"} reviewing ${startingReview.kind === "plan" ? "plan" : "code"}`,
    detail: `${reviewKindLabel(startingReview.kind)} · round 1/${startingReview.maxRounds}`,
  };
}

function iconForRun(run: ReviewRunDetail): ReactNode {
  const assignment = latestReviewRound(run)?.assignments[0] ?? null;
  return (
    <AgentGlyph
      agentKind={assignment?.agentKind ?? "codex"}
      color={resolveSubagentColor(assignment?.sessionLinkId ?? assignment?.id ?? run.id)}
      className="size-4"
    />
  );
}

function iconForStartingReview(startingReview: StartingReviewState): ReactNode {
  const reviewer = startingReview.reviewers[0] ?? null;
  return (
    <AgentGlyph
      agentKind={reviewer?.agentKind ?? "codex"}
      color={resolveSubagentColor(reviewer?.id ?? startingReview.parentSessionId)}
      className="size-4"
    />
  );
}

function composerAssignmentStatusLabel(assignment: ReviewAssignmentDetail): string {
  if (assignment.status === "submitted") {
    return assignment.pass ? "Approved" : "Changes";
  }
  return reviewAssignmentStatusLabel(assignment);
}

function assignmentSecondaryText(assignment: ReviewAssignmentDetail): string | null {
  if (assignment.summary?.trim()) {
    return assignment.summary.trim();
  }
  if (assignment.failureDetail?.trim()) {
    return assignment.failureDetail.trim();
  }
  if (assignment.failureReason?.trim()) {
    return humanizeFailureReason(assignment.failureReason);
  }
  return null;
}

function formatAssignmentHarness(assignment: ReviewAssignmentDetail): string {
  return [getProviderDisplayName(assignment.agentKind), assignment.modelId]
    .filter(Boolean)
    .join(" · ");
}

function formatReviewerHarness(
  reviewer: StartingReviewState["reviewers"][number],
): string {
  return [getProviderDisplayName(reviewer.agentKind), reviewer.modelId]
    .filter(Boolean)
    .join(" · ");
}

function assignmentStatusClassName(assignment: ReviewAssignmentDetail): string {
  if (assignment.status === "submitted" && assignment.pass) {
    return "text-foreground";
  }
  if (
    assignment.status === "submitted"
    || assignment.status === "system_failed"
    || assignment.status === "timed_out"
    || assignment.status === "retryable_failed"
  ) {
    return "text-destructive";
  }
  return "text-muted-foreground";
}

function humanizeFailureReason(reason: string): string {
  return reason.replaceAll("_", " ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
