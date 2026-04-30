import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight } from "@/components/ui/icons";

export type ToolActionStatus = "running" | "completed" | "failed";

interface ToolActionRowProps {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  status: ToolActionStatus;
  duration?: string;
  children?: ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  expandable?: boolean;
  className?: string;
}

export function ToolActionRow({
  icon,
  label,
  hint,
  status,
  duration,
  children,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  expandable = true,
  className = "",
}: ToolActionRowProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? internalExpanded;
  const hasDetails = expandable && !!children;

  const setExpanded = (next: boolean) => {
    if (controlledExpanded === undefined) {
      setInternalExpanded(next);
    }
    onExpandedChange?.(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target === event.currentTarget
      && (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      setExpanded(!expanded);
    }
  };

  return (
    <div className={className}>
      {hasDetails ? (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          className={`group/tool-action-row inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-none bg-transparent p-0 text-left text-chat leading-relaxed font-normal outline-none focus-visible:underline ${
            status === "failed"
              ? "text-destructive/80 hover:text-destructive"
              : "text-muted-foreground/80 hover:text-foreground"
          }`}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={handleKeyDown}
        >
          <ToolActionRowContent
            icon={icon}
            label={label}
            hint={hint}
            duration={duration}
            expandable
            expanded={expanded}
          />
        </div>
      ) : (
        <div
          className={`inline-flex min-w-0 max-w-full items-center gap-1 text-chat leading-relaxed ${
            status === "failed" ? "text-destructive/80" : "text-muted-foreground/80"
          }`}
        >
          <ToolActionRowContent
            icon={icon}
            label={label}
            hint={hint}
            duration={duration}
            expandable={false}
            expanded={false}
          />
        </div>
      )}
      {expanded && children && (
        <div className="mt-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

function ToolActionRowContent({
  icon,
  label,
  hint,
  duration,
  expandable,
  expanded,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  duration?: string;
  expandable: boolean;
  expanded: boolean;
}) {
  return (
    <>
      <ToolActionLeadingAffordance
        icon={icon}
        expandable={expandable}
        expanded={expanded}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <div className="min-w-0 shrink-0 text-inherit">{label}</div>
        {renderInlineHint(hint)}
        {duration && (
          <span className="ml-auto shrink-0 text-sm text-faint">
            {duration}
          </span>
        )}
      </div>
    </>
  );
}

export function ToolActionLeadingAffordance({
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
        className={`absolute inset-0 flex items-center justify-center transition-all duration-150 ${
          expandable
            ? expanded
              ? "scale-75 opacity-0"
              : "scale-100 opacity-100 group-hover/tool-action-row:scale-75 group-hover/tool-action-row:opacity-0 group-focus-visible/tool-action-row:scale-75 group-focus-visible/tool-action-row:opacity-0"
            : "scale-100 opacity-100"
        }`}
      >
        <span className="flex h-3 w-3 items-center justify-center text-xs leading-none transition-colors [&_svg]:size-2.5 [&_svg]:text-muted-foreground group-hover/tool-action-row:[&_svg]:text-foreground/70">
          {icon}
        </span>
      </span>
      <span
        className={`absolute inset-0 flex items-center justify-center transition-all duration-150 ${
          expandable
            ? expanded
              ? "scale-100 opacity-100"
              : "scale-75 opacity-0 group-hover/tool-action-row:scale-100 group-hover/tool-action-row:opacity-100 group-focus-visible/tool-action-row:scale-100 group-focus-visible/tool-action-row:opacity-100"
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
