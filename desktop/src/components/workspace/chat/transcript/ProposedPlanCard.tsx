import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import {
  Check,
  ChevronDown,
  Copy,
  FileText,
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
  isApproving?: boolean;
  isRejecting?: boolean;
  isImplementingHere?: boolean;
}

const COLLAPSED_MAX_HEIGHT = "min(20rem,45vh)";
const COLLAPSED_FADE =
  "linear-gradient(to bottom, black 0, black calc(100% - 5rem), transparent 100%)";

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
  isApproving = false,
  isRejecting = false,
  isImplementingHere = false,
}: ProposedPlanCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const hasContent = content.length > 0;
  const canDecide =
    decisionState === "pending"
    && decisionVersion !== null
    && onApprove
    && onReject;

  const handleCopy = () => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div
      data-chat-selection-unit
      className="relative overflow-clip rounded-lg bg-foreground/5"
    >
      <div className="relative flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-base font-semibold leading-tight text-foreground">
            {title?.trim() || "Plan"}
          </span>
          {decisionState && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDecisionState(decisionState, nativeResolutionState, errorMessage)}
            </span>
          )}
        </div>
        {hasContent && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleCopy}
              aria-label="Copy plan"
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse plan summary" : "Expand plan summary"}
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
              />
            </Button>
          </div>
        )}
      </div>
      {!hasContent ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          {isStreaming ? "Preparing plan…" : "No plan content"}
        </div>
      ) : expanded ? (
        <div className="px-4 py-3">
          <MarkdownRenderer
            content={content}
            className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          />
        </div>
      ) : (
        <div className="relative">
          <div
            className="overflow-hidden px-4 py-3"
            style={{
              maxHeight: COLLAPSED_MAX_HEIGHT,
              maskImage: COLLAPSED_FADE,
              WebkitMaskImage: COLLAPSED_FADE,
            }}
          >
            <MarkdownRenderer
              content={content}
              className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              type="button"
              variant="inverted"
              size="pill"
              onClick={() => setExpanded(true)}
              className="pointer-events-auto px-3 py-0.5 text-sm"
            >
              Expand plan
            </Button>
          </div>
        </div>
      )}
      {decisionState && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 px-3 py-2">
          {canDecide && (
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
        </div>
      )}
    </div>
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
