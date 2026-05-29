import { Button } from "@proliferate/ui/primitives/Button";
import type { ReviewSetupAnchorRect } from "@/stores/reviews/review-ui-store";
import { CollapsiblePlanCard } from "@/components/workspace/chat/content/CollapsiblePlanCard";
import {
  Check,
  FileText,
  ArrowRight,
  Shield,
  Settings,
  X,
} from "@proliferate/ui/icons";

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
  nativeContinuation?: boolean;
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
  nativeContinuation = false,
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
  const canRetryNativeApproval =
    nativeContinuation
    && decisionState === "approved"
    && nativeResolutionState === "pending_link"
    && decisionVersion !== null
    && onApprove;
  const canDecide =
    decisionState === "pending"
    && decisionVersion !== null
    && onApprove
    && onReject;
  const canReview =
    (!!onReview || !!onConfigureReview)
    && (decisionState === null || decisionState === "pending" || decisionState === "approved");
  const hasFooterActions = !!decisionState || !!onHandOffToNewSession || canReview;
  const status = decisionState
    ? resolveDecisionStatus(
      decisionState,
      nativeResolutionState,
      errorMessage,
      nativeContinuation,
    )
    : null;
  const showImplementHere =
    decisionState === "approved"
    && !!onImplementHere
    && (!nativeContinuation || nativeResolutionState === "failed");
  const approveLabel = nativeContinuation ? "Approve and continue" : "Approve plan";

  return (
    <CollapsiblePlanCard
      title={title?.trim() || "Plan"}
      content={content}
      subtitle={status ? (
        <span className={status.className}>
          <span className={status.dotClassName} />
          {status.label}
        </span>
      ) : undefined}
      emptyContent={isStreaming ? "Preparing plan..." : "No plan content"}
      copyLabel="Copy plan"
      collapseLabel="Collapse plan summary"
      expandLabel="Expand plan summary"
      markdownPresentation="proposal"
      footer={hasFooterActions ? (
        <div
          data-chat-transcript-ignore
          className="flex flex-wrap items-center gap-2 border-t border-border/40 px-3.5 py-2.5"
        >
          {canReview && onConfigureReview && (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={(event) => onConfigureReview(
                rectToReviewAnchor(event.currentTarget.getBoundingClientRect()),
              )}
              title="Configure review agents."
              aria-label="Configure review agents"
              className="size-8 rounded-md text-muted-foreground"
            >
              <Settings className="size-3.5" />
            </Button>
          )}
          {canDecide && decisionState && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReject}
              loading={isRejecting}
              disabled={isApproving}
              className="rounded-md px-2.5 text-sm"
            >
              <X className="size-3.5" />
              Reject
            </Button>
          )}
          <span className="min-w-2 flex-1" />
          {canReview && onReview && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReview}
              loading={isStartingReview}
              title="Start review agents for this plan."
              className="rounded-md px-2.5 text-sm"
            >
              <Shield className="size-3.5" />
              Review
            </Button>
          )}
          {onHandOffToNewSession && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onHandOffToNewSession}
              title="Start a new session with this plan attached."
              className="rounded-md px-2.5 text-sm"
            >
              <ArrowRight className="size-3.5" />
              Start in new session
            </Button>
          )}
          {showImplementHere && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onImplementHere}
              loading={isImplementingHere}
              className="rounded-md px-2.5 text-sm"
            >
              <FileText className="size-3.5" />
              {nativeContinuation ? "Carry out here instead" : "Carry out here"}
            </Button>
          )}
          {(canDecide || canRetryNativeApproval) && decisionState && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onApprove}
              loading={isApproving}
              disabled={isRejecting}
              className="rounded-md px-2.5 text-sm"
            >
              <Check className="size-3.5" />
              {canRetryNativeApproval ? "Continue agent" : approveLabel}
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

interface DecisionStatus {
  label: string;
  className: string;
  dotClassName: string;
}

function resolveDecisionStatus(
  decisionState: ProposedPlanDecisionState,
  nativeResolutionState: ProposedPlanNativeResolutionState | null,
  errorMessage: string | null,
  nativeContinuation: boolean,
): DecisionStatus {
  const baseClassName =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium leading-none";

  if (nativeResolutionState === "failed") {
    return {
      label: errorMessage?.trim() || "agent resolution failed",
      className: `${baseClassName} bg-destructive text-destructive-foreground`,
      dotClassName: "size-1.5 rounded-full bg-current",
    };
  }
  if (nativeResolutionState === "pending_link") {
    return {
      label: nativeContinuation && decisionState === "approved"
        ? "waiting to continue"
        : nativeContinuation
          ? "awaiting approval"
          : "awaiting decision",
      className: `${baseClassName} bg-warning text-warning-foreground`,
      dotClassName: "size-1.5 rounded-full bg-current",
    };
  }
  if (nativeResolutionState === "pending_resolution") {
    return {
      label: nativeContinuation ? "continuing" : "resolving",
      className: `${baseClassName} bg-warning text-warning-foreground`,
      dotClassName: "size-1.5 rounded-full bg-current",
    };
  }

  switch (decisionState) {
    case "approved": {
      return {
        label: "approved",
        className: `${baseClassName} bg-foreground/10 text-foreground`,
        dotClassName: "size-1.5 rounded-full bg-current",
      };
    }
    case "rejected": {
      return {
        label: "rejected",
        className: `${baseClassName} bg-muted text-muted-foreground`,
        dotClassName: "size-1.5 rounded-full bg-current",
      };
    }
    case "superseded": {
      return {
        label: "superseded",
        className: `${baseClassName} bg-muted text-muted-foreground`,
        dotClassName: "size-1.5 rounded-full bg-current",
      };
    }
    case "pending":
    default: {
      return {
        label: "pending",
        className: `${baseClassName} bg-warning text-warning-foreground`,
        dotClassName: "size-1.5 rounded-full bg-current",
      };
    }
  }
}
