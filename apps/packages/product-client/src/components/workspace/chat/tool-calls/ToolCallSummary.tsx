import { useState } from "react";
import { AnimatedCollapsibleContent } from "@proliferate/ui/primitives/AnimatedCollapsibleContent";
import { TurnSeparator } from "#product/components/workspace/chat/transcript/TurnSeparator";
import { TURN_ITEM_GAP_CLASS } from "#product/components/workspace/chat/transcript/TranscriptTurnChrome";

interface ToolCallSummaryProps {
  label?: string;
  summary: string;
  children?: React.ReactNode;
  renderChildren?: () => React.ReactNode;
  itemCount?: number;
  defaultExpanded?: boolean;
  /** When true, renders the completed-work hairline below the disclosure. */
  showWorkDivider?: boolean;
  /** Always-visible completion UI that remains part of the work block. */
  completionContent?: React.ReactNode;
  /** Fade in only when a mounted live turn becomes completed history. */
  animateCompletion?: boolean;
  /** Removes only the outer disclosure border box; nested detail panels stay framed. */
  borderless?: boolean;
}

export function ToolCallSummary({
  label: _label = "Work history",
  summary,
  children,
  renderChildren,
  itemCount,
  defaultExpanded = false,
  showWorkDivider = false,
  completionContent = null,
  animateCompletion = false,
  borderless = false,
}: ToolCallSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hasExpanded, setHasExpanded] = useState(defaultExpanded);
  const renderedChildren = hasExpanded || (itemCount !== undefined && itemCount <= 1)
    ? renderChildren?.() ?? children
    : null;

  if (itemCount !== undefined && itemCount <= 1) {
    return <>{renderedChildren}</>;
  }

  return (
    <div
      className={`min-w-0 ${animateCompletion ? "motion-safe:animate-status-crossfade" : ""}`}
      data-completed-work-summary
      data-completed-work-transition={animateCompletion ? "true" : undefined}
    >
      <TurnSeparator
        label={showWorkDivider ? _label : summary}
        interactive
        expanded={expanded}
        onClick={() => {
          const nextExpanded = !expanded;
          setExpanded(nextExpanded);
          if (nextExpanded) setHasExpanded(true);
        }}
        borderless={borderless}
      />
      <AnimatedCollapsibleContent expanded={expanded}>
        <div
          className={`mt-4 flex flex-col ${TURN_ITEM_GAP_CLASS}`}
          data-completed-work-ledger
        >
          {renderedChildren}
        </div>
      </AnimatedCollapsibleContent>
      {completionContent && (
        <div className="mt-4 flex flex-col gap-4" data-completed-work-content>
          {completionContent}
        </div>
      )}
      {showWorkDivider && !expanded && <ToolCallWorkDivider className="mt-1" />}
    </div>
  );
}

export function ToolCallWorkDivider({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-chat-transcript-ignore
      data-completed-work-divider
      className={`${className} w-full border-t border-border`}
    />
  );
}
