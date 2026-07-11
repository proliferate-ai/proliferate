import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";
import type { CloudTranscriptActionStatus } from "./CloudChatTranscriptTypes";

export function CloudTranscriptActionRow({
  icon,
  label,
  hint,
  status,
  statusLabel,
  children,
  defaultExpanded = false,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  status: CloudTranscriptActionStatus;
  statusLabel?: string | null;
  children?: ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasDetails = Boolean(children);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.target === event.currentTarget
      && (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      setExpanded((value) => !value);
    }
  }

  return (
    <div className="max-w-full py-0.5">
      {hasDetails ? (
        <div
          role="button"
          tabIndex={0}
          data-chat-transcript-ignore
          aria-expanded={expanded}
          className={`group/tool-action-row inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-none bg-transparent p-0 text-left text-chat font-normal leading-[var(--text-chat--line-height)] outline-none focus-visible:underline ${
            status === "failed"
              ? "text-destructive/80 hover:text-destructive"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setExpanded((value) => !value)}
          onKeyDown={handleKeyDown}
        >
          <CloudTranscriptActionRowContent
            icon={icon}
            label={label}
            hint={hint}
            statusLabel={statusLabel}
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
          <CloudTranscriptActionRowContent
            icon={icon}
            label={label}
            hint={hint}
            statusLabel={statusLabel}
            expandable={false}
            expanded={false}
          />
        </div>
      )}
      {expanded && children ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}

function CloudTranscriptActionRowContent({
  icon,
  label,
  hint,
  statusLabel,
  expandable,
  expanded,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  statusLabel?: string | null;
  expandable: boolean;
  expanded: boolean;
}) {
  return (
    <>
      <CloudTranscriptActionLeadingAffordance
        icon={icon}
        expandable={expandable}
        expanded={expanded}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <div className="min-w-0 shrink-0 text-inherit">{label}</div>
        {renderInlineHint(hint)}
        {statusLabel ? (
          <span className="shrink-0 text-muted-foreground/80">
            {statusLabel}
          </span>
        ) : null}
      </div>
    </>
  );
}

function CloudTranscriptActionLeadingAffordance({
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
        className={`absolute inset-0 flex items-center justify-center transition-all duration-150 ${
          expandable
            ? expanded
              ? "scale-75 opacity-0"
              : "scale-100 opacity-100 group-hover/tool-action-row:scale-75 group-hover/tool-action-row:opacity-0 group-focus-visible/tool-action-row:scale-75 group-focus-visible/tool-action-row:opacity-0"
            : "scale-100 opacity-100"
        }`}
      >
        <span className="flex size-4 items-center justify-center text-xs leading-none transition-colors [&_svg]:size-4 [&_svg]:text-muted-foreground group-hover/tool-action-row:[&_svg]:text-foreground/70">
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
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </span>
    </span>
  );
}

export function CloudTranscriptDetailsPanel({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-foreground/[0.04]">
      {children}
    </div>
  );
}

export function CloudTurnSeparator({
  label,
  interactive = false,
  expanded = false,
  onClick,
}: {
  label: string;
  interactive?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}) {
  if (interactive) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        onClick={onClick}
        className="h-auto max-w-full justify-start gap-1 whitespace-normal rounded-md border border-transparent bg-transparent px-0 py-0 text-chat leading-[var(--text-chat--line-height)] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </Button>
    );
  }

  return (
    <div className="text-chat leading-[var(--text-chat--line-height)] text-muted-foreground">
      {label}
    </div>
  );
}

function renderInlineHint(hint?: ReactNode) {
  if (hint === undefined || hint === null || hint === false) {
    return null;
  }

  if (typeof hint === "string" || typeof hint === "number") {
    const value = String(hint).trim();
    if (!value) {
      return null;
    }
    return (
      <span
        title={value}
        className="max-w-[260px] min-w-0 shrink truncate text-ui leading-5 text-current"
        data-telemetry-mask
      >
        {value}
      </span>
    );
  }

  return <div className="min-w-0 shrink">{hint}</div>;
}
