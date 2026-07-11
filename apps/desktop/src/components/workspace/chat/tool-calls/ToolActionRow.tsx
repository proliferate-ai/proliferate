import { useState, type KeyboardEvent, type ReactNode } from "react";

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
          data-chat-transcript-ignore
          aria-expanded={expanded}
          className={`group/tool-action-row inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-none bg-transparent p-0 text-left text-chat leading-[var(--text-chat--line-height)] font-normal outline-none focus-visible:underline ${
            status === "failed"
              ? "text-destructive/80 hover:text-destructive"
              : "text-muted-foreground hover:text-foreground"
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
          className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-chat leading-[var(--text-chat--line-height)] ${
            status === "failed" ? "text-destructive/80" : "text-muted-foreground"
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
          // Inherits the row's text-chat size so status suffixes match the label.
          <span className="ml-auto shrink-0 text-faint">
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
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <span
        className={`absolute inset-0 flex items-center justify-center text-xs leading-none transition-colors [&_svg]:size-4 ${
          expanded
            ? "[&_svg]:text-foreground/75"
            : expandable
              ? "[&_svg]:text-muted-foreground group-hover/tool-action-row:[&_svg]:text-foreground group-focus-visible/tool-action-row:[&_svg]:text-foreground"
              : "[&_svg]:text-muted-foreground"
        }`}
      >
        {icon}
      </span>
    </span>
  );
}

function renderInlineHint(hint?: ReactNode) {
  if (hint === undefined || hint === null || hint === false) {
    return null;
  }

  if (typeof hint === "string" || typeof hint === "number") {
    // Codex parity: commands/paths render as flat muted mono text in the row —
    // no chip/pill chrome (codex mono = `--codex-chat-code-font-size`, one step
    // under chat text; ours uses the 13px UI step instead of the old 11px
    // transcript metadata size). Color inherits so hover brightens the command
    // together with the label.
    return (
      <span
        title={String(hint)}
        className="max-w-[280px] min-w-0 shrink truncate text-ui leading-5 text-current"
      >
        {hint}
      </span>
    );
  }

  return <div className="min-w-0 shrink">{hint}</div>;
}
