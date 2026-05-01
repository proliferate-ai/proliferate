import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";
import {
  ArrowRight,
  CircleAlert,
  CircleQuestion,
  ClipboardList,
  Clock,
  GitMerge,
  MessageSquare,
  Spinner,
} from "@/components/ui/icons";
import { IconButton } from "@/components/ui/IconButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  SidebarDetailIndicator,
  SidebarIndicatorAction,
  SidebarStatusIndicator,
} from "@/lib/domain/workspaces/sidebar";
import { SidebarWorkspaceVariantIcon } from "./SidebarWorkspaceVariantIcon";

interface SidebarStatusIndicatorViewProps {
  indicator: SidebarStatusIndicator | null | undefined;
  onAction?: (action: SidebarIndicatorAction) => void;
}

interface SidebarDetailIndicatorsViewProps {
  indicators: SidebarDetailIndicator[];
  archived?: boolean;
  onAction?: (action: SidebarIndicatorAction) => void;
}

interface SidebarStatusGlyphProps {
  indicator: SidebarStatusIndicator;
}

export function SidebarStatusGlyph({
  indicator,
}: SidebarStatusGlyphProps): ReactNode {
  switch (indicator.kind) {
    case "error":
      return <CircleAlert className="size-3 text-destructive" />;
    case "waiting_input":
      return <CircleQuestion className="size-3 text-info" />;
    case "waiting_plan":
      return <ClipboardList className="size-3 text-info" />;
    case "iterating":
      return <Spinner className="size-3 text-sidebar-muted-foreground opacity-60" />;
    case "queued_prompt":
      return <MessageSquare className="size-3 text-info" />;
    case "needs_review":
      return <div className="size-1.5 rounded-full bg-unread" />;
  }
}

export function SidebarStatusIndicatorView({
  indicator,
  onAction,
}: SidebarStatusIndicatorViewProps) {
  if (!indicator) {
    return null;
  }

  const action = "action" in indicator ? indicator.action : null;
  const glyph = <SidebarStatusGlyph indicator={indicator} />;

  return (
    <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
      {action && onAction ? (
        <IconButton
          tone="sidebar"
          size="sm"
          title={indicator.tooltip}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onAction(action);
          }}
          className="!size-4 !px-0 hover:bg-transparent"
        >
          {glyph}
        </IconButton>
      ) : (
        glyph
      )}
    </Tooltip>
  );
}

export function SidebarDetailIndicatorsView({
  indicators,
  archived = false,
  onAction,
}: SidebarDetailIndicatorsViewProps) {
  if (indicators.length === 0) {
    return null;
  }

  const className = archived
    ? "text-sidebar-muted-foreground/40"
    : "text-sidebar-muted-foreground";

  return (
    <>
      {indicators.map((indicator) => (
        <SidebarDetailIndicatorView
          key={detailIndicatorKey(indicator)}
          indicator={indicator}
          className={className}
          onAction={onAction}
        />
      ))}
    </>
  );
}

function SidebarDetailIndicatorView({
  indicator,
  className,
  onAction,
}: {
  indicator: SidebarDetailIndicator;
  className: string;
  onAction?: (action: SidebarIndicatorAction) => void;
}) {
  if (indicator.kind === "materialization") {
    return (
      <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
        <SidebarWorkspaceVariantIcon
          variant={indicator.variant}
          className={`size-3 ${className}`}
        />
      </Tooltip>
    );
  }

  if (indicator.kind === "finish_suggestion") {
    return (
      <FinishSuggestionIndicator
        indicator={indicator}
        className={className}
        onAction={onAction}
      />
    );
  }

  const glyph = indicator.kind === "automation"
    ? <Clock className="size-3" />
    : <ArrowRight className="size-3" />;
  const action = indicator.action ?? null;

  return (
    <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
      {action && onAction ? (
        <IconButton
          tone="sidebar"
          size="sm"
          title={indicator.tooltip}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onAction(action);
          }}
          className={`!size-4 !px-0 hover:bg-transparent ${className}`}
        >
          {glyph}
        </IconButton>
      ) : (
        <span className={className}>{glyph}</span>
      )}
    </Tooltip>
  );
}

function FinishSuggestionIndicator({
  indicator,
  className,
  onAction,
}: {
  indicator: Extract<SidebarDetailIndicator, { kind: "finish_suggestion" }>;
  className: string;
  onAction?: (action: SidebarIndicatorAction) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const trigger = (
    <IconButton
      tone="sidebar"
      size="sm"
      title={indicator.tooltip}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
      }}
      className={`!size-4 !px-0 hover:bg-transparent ${className}`}
    >
      <GitMerge className="size-3" />
    </IconButton>
  );

  return (
    <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
      <PopoverButton
        trigger={trigger}
        stopPropagation
        className="w-44 rounded-xl border border-border bg-popover p-1 shadow-floating"
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirming(false);
        }}
      >
        {(close) => confirming ? (
          <>
            <PopoverMenuItem
              label="Confirm done"
              variant="sidebar"
              onClick={() => {
                close();
                onAction?.({
                  kind: "mark_workspace_done",
                  workspaceId: indicator.workspaceId,
                  logicalWorkspaceId: indicator.logicalWorkspaceId,
                });
              }}
            />
            <PopoverMenuItem
              label="Cancel"
              variant="sidebar"
              onClick={() => setConfirming(false)}
            />
          </>
        ) : (
          <>
            <PopoverMenuItem
              label="Mark done"
              variant="sidebar"
              onClick={() => setConfirming(true)}
            />
            <PopoverMenuItem
              label="Keep active"
              variant="sidebar"
              onClick={() => {
                close();
                onAction?.({
                  kind: "keep_workspace_active",
                  workspaceId: indicator.workspaceId,
                  readinessFingerprint: indicator.readinessFingerprint,
                });
              }}
            />
          </>
        )}
      </PopoverButton>
    </Tooltip>
  );
}

function detailIndicatorKey(indicator: SidebarDetailIndicator): string {
  switch (indicator.kind) {
    case "materialization":
      return `materialization:${indicator.variant}`;
    case "automation":
      return "automation";
    case "agent":
      return "agent";
    case "finish_suggestion":
      return `finish:${indicator.workspaceId}:${indicator.readinessFingerprint}`;
  }
}
