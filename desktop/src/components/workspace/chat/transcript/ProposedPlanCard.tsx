import { Button } from "@/components/ui/Button";
import type { ReviewSetupAnchorRect } from "@/stores/reviews/review-ui-store";
import { CollapsiblePlanCard } from "@/components/workspace/chat/content/CollapsiblePlanCard";
import {
  Check,
  FileText,
  ArrowRight,
  Shield,
  Settings,
  X,
} from "@/components/ui/icons";

type ProposedPlanDecisionState =
  | "pending"
  | "approved"
  | "rejected"
  | "superseded";

type ProposedPlanNativeResolutionState =
  | "none"
  | "pending_link"
  | "pending_resolution"
  | "finalized"
  | "failed";

interface ProposedPlanCardProps {
  content: string;
  isStreaming: boolean;
  title?: string | null;
  decisionState?: ProposedPlanDecisionState | null;
  nativeResolutionState?: ProposedPlanNativeResolutionState | null;
  decisionVersion?: number | null;
  errorMessage?: string | null;
  onApprove?: () => void;
  onReject?: () => void;
  onImplementHere?: () => void;
  onHandOffToNewSession?: () => void;
  onReview?: () => void;
  onConfigureReview?: (anchorRect?: ReviewSetupAnchorRect | null) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  isImplementingHere?: boolean;
  isStartingReview?: boolean;
}

export function ProposedPlanCard({
  content,
  isStreaming,
  title = "Plan",
  decisionState = null,
  nativeResolutionState = null,
  decisionVersion = null,
  errorMessage = null,
  onApprove,
  onReject,
  onImplementHere,
  onHandOffToNewSession,
  onReview,
  onConfigureReview,
  isApproving = false,
  isRejecting = false,
  isImplementingHere = false,
  isStartingReview = false,
}: ProposedPlanCardProps) {
  const canDecide =
    decisionState === "pending"
    && decisionVersion !== null
    && onApprove
    && onReject;
  const canReview =
    (!!onReview || !!onConfigureReview)
    && (decisionState === null || decisionState === "pending" || decisionState === "approved");
  const hasFooterActions = !!decisionState || !!onHandOffToNewSession || canReview;

  return (
    <CollapsiblePlanCard
      title={title?.trim() || "Plan"}
      content={content}
      subtitle={decisionState ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDecisionState(decisionState, nativeResolutionState, errorMessage)}
        </span>
      ) : undefined}
      emptyContent={isStreaming ? "Preparing plan..." : "No plan content"}
      copyLabel="Copy plan"
      collapseLabel="Collapse plan summary"
      expandLabel="Expand plan summary"
      footer={hasFooterActions ? (
        <div
          data-chat-transcript-ignore
          className="flex flex-wrap items-center gap-2 border-t border-border/40 px-3 py-2"
        >
          {canDecide && decisionState && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onReject}
                loading={isRejecting}
                disabled={isApproving}
                className="rounded-xl px-2.5 text-sm"
              >
                <X className="size-3.5" />
                Reject
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onApprove}
                loading={isApproving}
                disabled={isRejecting}
                className="rounded-xl px-2.5 text-sm"
              >
                <Check className="size-3.5" />
                Approve
              </Button>
            </>
          )}
          {decisionState === "approved" && onImplementHere && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onImplementHere}
              loading={isImplementingHere}
              className="rounded-xl px-2.5 text-sm"
            >
              <FileText className="size-3.5" />
              Carry out & exit plan mode
            </Button>
          )}
          {canReview && (
            <span className="flex items-center gap-1">
              {onReview && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onReview}
                  loading={isStartingReview}
                  title="Starts review agents for this plan."
                  className="rounded-xl px-2.5 text-sm"
                >
                  <Shield className="size-3.5" />
                  Review plan
                </Button>
              )}
              {onConfigureReview && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(event) => onConfigureReview(
                    rectToReviewAnchor(event.currentTarget.getBoundingClientRect()),
                  )}
                  title="Configure review agents."
                  className="rounded-xl px-2 text-sm"
                >
                  <Settings className="size-3.5" />
                </Button>
              )}
            </span>
          )}
          {onHandOffToNewSession && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onHandOffToNewSession}
              title="Starts a new session without approving or rejecting this plan."
              className="rounded-xl px-2.5 text-sm"
            >
              <ArrowRight className="size-3.5" />
              Hand off to new session
            </Button>
          )}
        </div>
      ) : undefined}
    />
  );
}

function rectToReviewAnchor(rect: DOMRect): ReviewSetupAnchorRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function formatDecisionState(
  decisionState: ProposedPlanDecisionState,
  nativeResolutionState: ProposedPlanNativeResolutionState | null,
  errorMessage: string | null,
): string {
  if (nativeResolutionState === "failed") {
    return errorMessage?.trim() || "agent resolution failed";
  }
  if (nativeResolutionState === "pending_link") {
    return "waiting for agent";
  }
  if (nativeResolutionState === "pending_resolution") {
    return "resolving";
  }
  switch (decisionState) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "superseded":
      return "superseded";
    case "pending":
    default:
      return "pending";
  }
}
