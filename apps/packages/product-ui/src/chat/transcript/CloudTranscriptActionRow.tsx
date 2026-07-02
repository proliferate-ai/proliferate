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
          className={`group/tool-action-row inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-none bg-transparent p-0 text-left text-chat font-normal leading-[var(--text-chat--line-height)] outline-none focus-visible:underline ${
            status === "failed"
              ? "text-destructive/80 hover:text-destructive"
              : "text-muted-foreground/80 hover:text-foreground"
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
          className={`inline-flex min-w-0 max-w-full items-center gap-1 text-chat leading-[var(--text-chat--line-height)] ${
            status === "failed" ? "text-destructive/80" : "text-muted-foreground/80"
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
          <span className="shrink-0 text-xs text-muted-foreground/80">
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
          aria-hidden="true"
          className={`size-2.5 shrink-0 text-muted-foreground/70 transition-transform ${
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
  const content = (
    <>
      <div className="flex-1 border-t border-current/20" />
      <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
        <span className="truncate text-foreground/60">{label}</span>
        {interactive ? (
          <ChevronRight
            aria-hidden="true"
            className={`size-3 text-foreground/40 transition-transform duration-200 ${
              expanded ? "rotate-90" : ""
            }`}
          />
        ) : null}
      </span>
      <div className="flex-1 border-t border-current/20" />
    </>
  );

  if (interactive) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        onClick={onClick}
        className="h-auto w-full gap-2 whitespace-normal rounded-md border border-transparent bg-transparent px-0 py-1 text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-muted-foreground hover:bg-transparent hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
      >
        {content}
      </Button>
    );
  }

  return (
    <div className="my-2 flex items-center gap-2 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground">
      {content}
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
        className="max-w-[260px] min-w-0 shrink truncate rounded-sm border border-border/60 bg-muted/45 px-1.5 py-0.5 text-[0.6rem] leading-none text-muted-foreground"
        data-telemetry-mask
      >
        {value}
      </span>
    );
  }

  return <div className="min-w-0 shrink">{hint}</div>;
}
