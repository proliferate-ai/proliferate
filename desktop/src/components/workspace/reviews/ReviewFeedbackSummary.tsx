import type { ReviewAssignmentDetail } from "@anyharness/sdk";
import { useSessionReviewsQuery } from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import {
  AgentGlyph,
  GitPullRequest,
  PlanningIcon,
} from "@/components/ui/icons";
import { resolveSubagentColor } from "@/lib/domain/chat/subagent-braille-color";
import type { ReviewFeedbackPromptReference } from "@/lib/domain/chat/subagents/provenance";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";

interface ReviewFeedbackSummaryProps {
  reference: ReviewFeedbackPromptReference;
  sessionId: string | null;
  state?: "queued" | "completed";
  onOpenSession?: (sessionId: string) => void;
}

export function ReviewFeedbackSummary({
  reference,
  sessionId,
  state = "completed",
  onOpenSession,
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
  const title = reference.label?.trim()
    || reviewFeedbackTitle(assignments, target, state);
  const TargetIcon = run?.kind === "code" ? GitPullRequest : PlanningIcon;

  return (
    <div className="flex justify-end">
      <div
        className="max-w-[77%] rounded-2xl bg-foreground/5 px-3 py-2 text-foreground"
        data-telemetry-mask
      >
        <div className="flex min-w-0 items-center text-chat leading-[var(--text-chat--line-height)]">
          <span className="min-w-0 truncate font-medium">
            {title}
          </span>
        </div>
        <div className="mt-2 grid gap-1">
          {assignments.length > 0 ? assignments.map((assignment) => (
            <ReviewFeedbackAssignmentRow
              key={assignment.id}
              assignment={assignment}
              reviewRunId={reference.reviewRunId}
              TargetIcon={TargetIcon}
              onOpenSession={onOpenSession}
              onOpenCritique={() => {
                openCritique({
                  reviewRunId: reference.reviewRunId,
                  assignmentId: assignment.id,
                  personaLabel: assignment.personaLabel,
                });
              }}
            />
          )) : (
            <div className="text-chat leading-[var(--text-chat--line-height)] text-muted-foreground">
              Loading reviewer results...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewFeedbackAssignmentRow({
  assignment,
  reviewRunId,
  TargetIcon,
  onOpenSession,
  onOpenCritique,
}: {
  assignment: ReviewAssignmentDetail;
  reviewRunId: string;
  TargetIcon: typeof GitPullRequest | typeof PlanningIcon;
  onOpenSession?: (sessionId: string) => void;
  onOpenCritique: () => void;
}) {
  const color = resolveSubagentColor(assignment.sessionLinkId ?? assignment.id);
  const canOpenSession = !!assignment.reviewerSessionId && !!onOpenSession;
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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-chat leading-[var(--text-chat--line-height)]">
      <div className="flex min-w-0 items-center gap-1.5">
        {canOpenSession ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-chat-transcript-ignore
            aria-label={`Open ${assignment.personaLabel} session`}
            title={`Open ${assignment.personaLabel} session`}
            onClick={() => onOpenSession(assignment.reviewerSessionId!)}
            className="-ml-1"
          >
            <AgentGlyph agentKind={assignment.agentKind} color={color} className="size-4" />
          </Button>
        ) : (
          <AgentGlyph agentKind={assignment.agentKind} color={color} className="size-4" />
        )}
        <span className="min-w-0 truncate text-foreground">
          {assignment.personaLabel || reviewRunId}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={verdictClassName}>{verdict.label}</span>
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
            <TargetIcon className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function reviewFeedbackTitle(
  assignments: ReviewAssignmentDetail[],
  target: "plan" | "PR",
  state: "queued" | "completed",
): string {
  const reviewerCount = assignments.length;
  if (reviewerCount <= 0) {
    return state === "queued"
      ? `Agents critique the ${target}`
      : `Agents critiqued the ${target}`;
  }
  if (reviewerCount === 1) {
    const label = assignments[0]?.personaLabel?.trim() || "Reviewer";
    return state === "queued"
      ? `${label} critiques the ${target}`
      : `${label} critiqued the ${target}`;
  }
  const noun = reviewerCount === 1 ? "agent" : "agents";
  const verb = state === "queued"
    ? reviewerCount === 1 ? "critiques" : "critique"
    : "critiqued";
  return `${reviewerCount} ${noun} ${verb} the ${target}`;
}

function reviewAssignmentVerdict(assignment: ReviewAssignmentDetail): {
  label: string;
  tone: "approved" | "changes" | "pending";
} {
  if (assignment.status === "submitted") {
    return assignment.pass
      ? { label: "approved", tone: "approved" }
      : { label: "requested changes", tone: "changes" };
  }
  if (assignment.status === "timed_out") {
    return { label: "timed out", tone: "changes" };
  }
  if (assignment.status === "system_failed") {
    return { label: "failed", tone: "changes" };
  }
  if (assignment.status === "retryable_failed") {
    return { label: "needs retry", tone: "changes" };
  }
  return { label: "reviewing", tone: "pending" };
}
