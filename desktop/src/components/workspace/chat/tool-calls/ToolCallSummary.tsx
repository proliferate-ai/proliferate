import { useState } from "react";
import { TurnSeparator } from "@/components/workspace/chat/transcript/TurnSeparator";

interface ToolCallSummaryProps {
  icon: React.ReactNode;
  label?: string;
  summary: string;
  typeIcons: React.ReactNode[];
  children: React.ReactNode;
  itemCount?: number;
  defaultExpanded?: boolean;
  /** When true, shows a "Final message" separator after the expanded content. */
  showFinalSeparator?: boolean;
}

export function ToolCallSummary({
  icon: _icon,
  label: _label = "Work history",
  summary,
  typeIcons: _typeIcons,
  children,
  itemCount,
  defaultExpanded = false,
  showFinalSeparator = false,
}: ToolCallSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (itemCount !== undefined && itemCount <= 1) {
    return <>{children}</>;
  }

  return (
    <div className="py-1">
      <TurnSeparator
        label={summary}
        interactive
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      />
      {expanded && (
        <>
          <div className="mt-2 space-y-1.5">
            {children}
          </div>
          {showFinalSeparator && (
            <TurnSeparator label="Final message" />
          )}
        </>
      )}
    </div>
  );
}
