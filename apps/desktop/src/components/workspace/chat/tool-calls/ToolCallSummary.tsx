import { useState } from "react";
import { TurnSeparator } from "@/components/workspace/chat/transcript/TurnSeparator";

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
}: ToolCallSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const renderedChildren = expanded || (itemCount !== undefined && itemCount <= 1)
    ? renderChildren?.() ?? children
    : null;

  if (itemCount !== undefined && itemCount <= 1) {
    return <>{renderedChildren}</>;
  }

  return (
    <div className="min-w-0">
      <TurnSeparator
        label={showWorkDivider ? _label : summary}
        interactive
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      />
      {expanded && (
        <div className="mt-1 space-y-1.5">
          {renderedChildren}
        </div>
      )}
      {completionContent && (
        <div className="mt-4 flex flex-col gap-4" data-completed-work-content>
          {completionContent}
        </div>
      )}
      {showWorkDivider && <ToolCallWorkDivider className="mt-1" />}
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
