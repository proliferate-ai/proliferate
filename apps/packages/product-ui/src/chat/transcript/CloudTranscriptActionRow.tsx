import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@proliferate/ui/icons";
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
              : "text-foreground/60 hover:text-foreground"
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
            status === "failed" ? "text-destructive/80" : "text-foreground/60"
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
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <CloudTranscriptActionLeadingAffordance
          icon={icon}
          expandable={expandable}
          expanded={expanded}
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="min-w-0 shrink-0 text-inherit">{label}</div>
          {renderInlineHint(hint)}
          {statusLabel ? (
            <span className="shrink-0 text-faint">
              {statusLabel}
            </span>
          ) : null}
        </div>
      </div>
      {expandable ? (
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-foreground/40 opacity-0 transition-[opacity,transform] group-hover/tool-action-row:opacity-100 group-focus-visible/tool-action-row:opacity-100 ${
            expanded ? "rotate-90" : ""
          }`}
        />
      ) : null}
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
        className={`absolute inset-0 flex items-center justify-center text-xs leading-none transition-colors [&_svg]:size-4 ${
          expanded
            ? "[&_svg]:text-foreground/75"
            : expandable
              ? "[&_svg]:text-foreground/60 group-hover/tool-action-row:[&_svg]:text-foreground group-focus-visible/tool-action-row:[&_svg]:text-foreground"
              : "[&_svg]:text-foreground/60"
        }`}
      >
        {icon}
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
        className="h-auto max-w-full justify-start gap-1 rounded-md border border-transparent bg-transparent p-0 text-left text-[length:var(--text-chat)] font-normal leading-[var(--text-chat--line-height)] text-foreground/60 hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-foreground/40 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </Button>
    );
  }

  return (
    <div className="pt-1 text-foreground/60" data-chat-transcript-ignore>
      <div
        role="separator"
        aria-label={label}
        className="w-full border-t border-border"
      />
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
        className="max-w-[280px] min-w-0 shrink truncate font-mono text-[length:var(--text-chat-code,var(--text-chat))] leading-[var(--text-chat-code--line-height,var(--text-chat--line-height))] text-current"
        data-telemetry-mask
      >
        {value}
      </span>
    );
  }

  return <div className="min-w-0 shrink">{hint}</div>;
}
