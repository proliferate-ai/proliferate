import { useState, type ReactNode } from "react";
import { ChevronRight } from "@/components/ui/icons";

type ToolCallStatus = "running" | "completed" | "failed";
export const TOOL_CALL_BODY_MAX_HEIGHT_CLASS = "max-h-[220px]";

interface ToolCallBlockProps {
  icon?: ReactNode;
  name: ReactNode;
  hint?: ReactNode;
  status: ToolCallStatus;
  duration?: string;
  children?: ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  expandable?: boolean;
  bodyClassName?: string;
}

export function ToolCallBlock({
  icon,
  name,
  hint,
  status,
  duration,
  children,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  expandable = true,
  bodyClassName = "",
}: ToolCallBlockProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = (next: boolean) => {
    if (controlledExpanded === undefined) {
      setInternalExpanded(next);
    }
    onExpandedChange?.(next);
  };
  const hasContent = expandable && !!children;
  const rowTextClass =
    status === "failed" ? "text-destructive/85" : "text-muted-foreground";

  return (
    <div>
      <div
        onClick={() => hasContent && setExpanded(!expanded)}
        className={`group/tool-row inline-flex min-w-0 max-w-full items-center gap-1 rounded-md pl-0.5 pr-1.5 text-sm leading-5 transition-colors ${hasContent
            ? `cursor-pointer ${rowTextClass} hover:bg-muted/40 hover:text-foreground`
            : `cursor-default ${rowTextClass}`
          }`}
      >
        <ToolCallLeadingAffordance
          icon={icon}
          expandable={hasContent}
          expanded={expanded}
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="shrink-0 text-inherit">{name}</div>
          {renderInlineHint(hint)}
          {duration && (
            <span className="ml-auto shrink-0 pt-0.5 text-sm text-faint">
              {duration}
            </span>
          )}
        </div>
      </div>
      {expanded && children && (
        <div className={`mt-1 ml-1 space-y-2 border-l border-border/70 pl-3 text-foreground ${bodyClassName}`}>
          {children}
        </div>
      )}
    </div>
  );
}

export function ToolCallLeadingAffordance({
  icon,
  expandable,
  expanded,
}: {
  icon?: ReactNode;
  expandable: boolean;
  expanded: boolean;
}) {
  return (
    <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
      <span
        className={`absolute inset-0 flex items-center justify-center transition-all duration-150 ${expandable
            ? expanded
              ? "scale-75 opacity-0"
              : "scale-100 opacity-100 group-hover/tool-row:scale-75 group-hover/tool-row:opacity-0 group-focus-visible/tool-row:scale-75 group-focus-visible/tool-row:opacity-0"
            : "scale-100 opacity-100"
          }`}
      >
        <span className="[&_svg]:size-2 [&_svg]:text-muted-foreground transition-colors group-hover/tool-row:[&_svg]:text-foreground/70">
          {icon}
        </span>
      </span>
      <span
        className={`absolute inset-0 flex items-center justify-center transition-all duration-150 ${expandable
            ? expanded
              ? "scale-100 opacity-100"
              : "scale-75 opacity-0 group-hover/tool-row:scale-100 group-hover/tool-row:opacity-100 group-focus-visible/tool-row:scale-100 group-focus-visible/tool-row:opacity-100"
            : "scale-75 opacity-0"
          }`}
      >
        <ChevronRight
          className={`size-2.5 shrink-0 text-faint transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </span>
    </span>
  );
}

function renderInlineHint(hint?: ReactNode) {
  if (hint === undefined || hint === null || hint === false) {
    return null;
  }

  if (typeof hint === "string" || typeof hint === "number") {
    return (
      <span
        title={String(hint)}
        className="max-w-[200px] min-w-0 shrink truncate rounded-sm border border-border/60 bg-muted/45 px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground"
      >
        {hint}
      </span>
    );
  } 

  return <div className="min-w-0 shrink">{hint}</div>;
}
