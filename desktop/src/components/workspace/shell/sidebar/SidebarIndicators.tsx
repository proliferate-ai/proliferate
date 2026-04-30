import type { MouseEvent, ReactNode } from "react";
import {
  ArrowRight,
  CircleAlert,
  Clock,
  MessageSquare,
  Spinner,
} from "@/components/ui/icons";
import { IconButton } from "@/components/ui/IconButton";
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
    case "waiting_plan":
    case "iterating":
      return <Spinner className="size-3.5 text-sidebar-muted-foreground opacity-60" />;
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

function detailIndicatorKey(indicator: SidebarDetailIndicator): string {
  switch (indicator.kind) {
    case "materialization":
      return `materialization:${indicator.variant}`;
    case "automation":
      return "automation";
    case "agent":
      return "agent";
  }
}
