import { useState } from "react";
import { TurnSeparator } from "@/components/workspace/chat/transcript/TurnSeparator";

interface ToolCallSummaryProps {
  icon: React.ReactNode;
  label?: string;
  summary: string;
  typeIcons: React.ReactNode[];
  children?: React.ReactNode;
  renderChildren?: () => React.ReactNode;
  itemCount?: number;
  defaultExpanded?: boolean;
  /** When true, keeps a quiet boundary between work history and final prose. */
  showFinalSeparator?: boolean;
}

export function ToolCallSummary({
  icon: _icon,
  label = "Work history",
  summary,
  typeIcons: _typeIcons,
  children,
  renderChildren,
  itemCount,
  defaultExpanded = false,
  showFinalSeparator = false,
}: ToolCallSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const renderedChildren = expanded || (itemCount !== undefined && itemCount <= 1)
    ? renderChildren?.() ?? children
    : null;

  if (itemCount !== undefined && itemCount <= 1) {
    return <>{renderedChildren}</>;
  }

  return (
    <div>
      <TurnSeparator
        label={label}
        title={summary}
        interactive
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      />
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {renderedChildren}
        </div>
      )}
      {showFinalSeparator && (
        <TurnSeparator label="Final message" />
      )}
    </div>
  );
}
