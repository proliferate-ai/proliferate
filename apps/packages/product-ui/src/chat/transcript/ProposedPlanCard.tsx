import type { ComponentType } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import {
  Check,
  FileText,
  ArrowRight,
  MoreHorizontal,
  X,
} from "@proliferate/ui/icons";
import { CollapsiblePlanCard } from "./CollapsiblePlanCard";
import type {
  MarkdownCodeBlockRenderer,
  MarkdownInlineCodeRenderer,
  MarkdownLinkRenderer,
} from "./MarkdownBody";

type ProposedPlanDecisionState =
  // "streaming" is the pre-decision phase: the ExitPlanMode tool call is still
  // streaming its plan body. It renders through this exact component (as
  // ClaudePlanCard) with an identical shell — no chip, no footer — so that when
  // the proposed_plan item arrives the status chip and footer appear in place
  // with no chrome swap or remount.
  | "streaming"
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
  isApproving?: boolean;
  isRejecting?: boolean;
  isImplementingHere?: boolean;
  renderLink?: MarkdownLinkRenderer;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
}

interface FooterAction {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
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
  isApproving = false,
  isRejecting = false,
  isImplementingHere = false,
  renderLink,
  renderInlineCode,
  renderCodeBlock,
}: ProposedPlanCardProps) {
  const canRetryNativeApproval =
    nativeContinuation
    && decisionState === "approved"
    && nativeResolutionState === "pending_link"
    && decisionVersion !== null
    && Boolean(onApprove);
  const canDecide =
    decisionState === "pending"
    && decisionVersion !== null
    && Boolean(onApprove)
    && Boolean(onReject);
  const showImplementHere =
    decisionState === "approved"
    && Boolean(onImplementHere)
    && (!nativeContinuation || nativeResolutionState === "failed");

  // Status chip: fixed Title-case vocabulary only. The chip never carries a
  // raw error string — a failure surfaces its message on the note line below
  // the header instead.
  const status =
    decisionState && decisionState !== "streaming"
      ? resolveDecisionStatus(decisionState, nativeResolutionState)
      : null;
  const failureMessage =
    nativeResolutionState === "failed" ? errorMessage?.trim() || null : null;

  // Footer: at most two visible buttons — a primary (Approve / Run here) and a
  // secondary (Reject). Every other action lives in the "..." overflow menu.
  const approveAction: FooterAction | null =
    canDecide || canRetryNativeApproval
      ? {
        key: "approve",
        label: "Approve",
        icon: Check,
        onClick: onApprove,
        loading: isApproving,
        disabled: isRejecting,
      }
      : null;
  const rejectAction: FooterAction | null = canDecide
    ? {
      key: "reject",
      label: "Reject",
      icon: X,
      onClick: onReject,
      loading: isRejecting,
      disabled: isApproving,
    }
    : null;
  const runHereAction: FooterAction | null = showImplementHere
    ? {
      key: "run-here",
      label: "Run here",
      icon: FileText,
      onClick: onImplementHere,
      loading: isImplementingHere,
    }
    : null;
  const newSessionAction: FooterAction | null = onHandOffToNewSession
    ? {
      key: "new-session",
      label: "New session",
      icon: ArrowRight,
      onClick: onHandOffToNewSession,
    }
    : null;

  let primaryAction = approveAction ?? runHereAction ?? null;
  const overflowActions = [runHereAction, newSessionAction].filter(
    (action): action is FooterAction =>
      action !== null && action !== primaryAction,
  );
  // Never orphan a lone action inside an overflow menu with no visible button.
  if (!primaryAction && overflowActions.length > 0) {
    primaryAction = overflowActions.shift() ?? null;
  }

  const hasFooterActions = Boolean(
    primaryAction || rejectAction || overflowActions.length > 0,
  );

  return (
    <CollapsiblePlanCard
      title={title?.trim() || "Plan"}
      content={content}
      subtitle={status ? (
        <span className={`${status.className} chip-enter`}>
          <span className="size-1.5 shrink-0 rounded-full bg-current" />
          {status.label}
        </span>
      ) : undefined}
      note={failureMessage ? (
        <p className="px-4 pt-2 text-ui-sm text-destructive">
          {failureMessage}
        </p>
      ) : undefined}
      emptyContent={isStreaming ? "Preparing plan..." : "No plan content"}
      copyLabel="Copy plan"
      collapseLabel="Collapse plan summary"
      expandLabel="Expand plan summary"
      markdownPresentation="proposal"
      renderLink={renderLink}
      renderInlineCode={renderInlineCode}
      renderCodeBlock={renderCodeBlock}
      footer={hasFooterActions ? (
        <div
          data-chat-transcript-ignore
          className="flex items-center gap-2 border-t border-border/40 px-3.5 py-2.5"
        >
          {rejectAction && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={rejectAction.onClick}
              loading={rejectAction.loading}
              disabled={rejectAction.disabled}
              className="rounded-md px-2.5 text-ui-sm"
            >
              <rejectAction.icon className="size-3.5" />
              {rejectAction.label}
            </Button>
          )}
          <span className="min-w-2 flex-1" />
          {overflowActions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="More plan actions"
                  className="size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="shadow-popover">
                {overflowActions.map((action) => (
                  <DropdownMenuItem
                    key={action.key}
                    onSelect={() => action.onClick?.()}
                  >
                    <action.icon className="size-3.5" />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {primaryAction && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={primaryAction.onClick}
              loading={primaryAction.loading}
              disabled={primaryAction.disabled}
              className="rounded-md px-2.5 text-ui-sm"
            >
              <primaryAction.icon className="size-3.5" />
              {primaryAction.label}
            </Button>
          )}
        </div>
      ) : undefined}
    />
  );
}

interface DecisionStatus {
  label: string;
  className: string;
}

const CHIP_BASE_CLASSNAME =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-ui-sm font-medium leading-none";

function resolveDecisionStatus(
  decisionState: Exclude<ProposedPlanDecisionState, "streaming">,
  nativeResolutionState: ProposedPlanNativeResolutionState | null,
): DecisionStatus {
  if (nativeResolutionState === "failed") {
    return {
      label: "Failed",
      className: `${CHIP_BASE_CLASSNAME} bg-destructive text-destructive-foreground`,
    };
  }

  switch (decisionState) {
    case "approved": {
      return {
        label: "Approved",
        className: `${CHIP_BASE_CLASSNAME} bg-foreground/10 text-foreground`,
      };
    }
    case "rejected": {
      return {
        label: "Rejected",
        className: `${CHIP_BASE_CLASSNAME} bg-muted text-muted-foreground`,
      };
    }
    case "superseded": {
      return {
        label: "Superseded",
        className: `${CHIP_BASE_CLASSNAME} bg-muted text-muted-foreground`,
      };
    }
    case "pending":
    default: {
      return {
        label: "Awaiting approval",
        className: `${CHIP_BASE_CLASSNAME} bg-warning text-warning-foreground`,
      };
    }
  }
}
