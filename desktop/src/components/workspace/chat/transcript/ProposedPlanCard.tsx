import { Button } from "@/components/ui/Button";
import { CollapsiblePlanCard } from "@/components/workspace/chat/content/CollapsiblePlanCard";
import {
  Check,
  FileText,
  ArrowRight,
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
  isApproving?: boolean;
  isRejecting?: boolean;
  isImplementingHere?: boolean;
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
  isApproving = false,
  isRejecting = false,
  isImplementingHere = false,
}: ProposedPlanCardProps) {
  const canDecide =
    decisionState === "pending"
    && decisionVersion !== null
    && onApprove
    && onReject;
  const hasFooterActions = !!decisionState || !!onHandOffToNewSession;

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
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 px-3 py-2">
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
