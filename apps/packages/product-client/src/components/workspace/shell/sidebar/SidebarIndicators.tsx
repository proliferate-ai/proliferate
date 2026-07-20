import type { MouseEvent, ReactNode } from "react";
import {
  ArrowRight,
  CircleAlert,
  CircleUser,
  Clock,
  Globe,
  BotMessageSquare,
  MessageSquare,
  Spinner,
} from "@proliferate/ui/icons";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type {
  SidebarDetailIndicator,
  SidebarIndicatorAction,
  SidebarStatusIndicator,
} from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import { SidebarWorkspaceVariantIcon } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";

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
      return <CircleAlert className="icon-paired text-destructive" />;
    case "worktree_missing":
      return <CircleAlert className="icon-paired text-warning-foreground" />;
    case "waiting_input":
    case "waiting_plan":
      return <Clock className="icon-control text-info" />;
    case "iterating":
    case "queued_prompt":
      return <Spinner className="icon-control text-sidebar-foreground" />;
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
        <span role="img" aria-label={indicator.tooltip} className="inline-flex items-center justify-center">{glyph}</span>
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
          targetAppearance={indicator.targetAppearance ?? null}
          className={`icon-compact [font-size:var(--text-sidebar-row)] ${className}`}
        />
      </Tooltip>
    );
  }

  if (indicator.kind === "cloud_access" || indicator.kind === "cloud_exposure") {
    const glyph = indicator.kind === "cloud_access"
      ? <CircleUser className="icon-compact" />
      : <Globe className="icon-compact" />;
    return (
      <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
        <span className={detailToneClass(indicator.tone, className)}>
          {glyph}
        </span>
      </Tooltip>
    );
  }

  const glyph = indicator.kind === "automation"
    ? <BotMessageSquare className="icon-compact" />
    : indicator.kind === "agent"
      ? <MessageSquare className="icon-compact" />
      : <ArrowRight className="icon-compact" />;
  const action = "action" in indicator ? indicator.action ?? null : null;

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

function detailToneClass(
  tone: "neutral" | "success" | "warning" | "muted",
  fallbackClassName: string,
): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "muted":
      return "text-sidebar-muted-foreground/50";
    case "neutral":
    default:
      return fallbackClassName;
  }
}

function detailIndicatorKey(indicator: SidebarDetailIndicator): string {
  switch (indicator.kind) {
    case "materialization":
      return `materialization:${indicator.variant}`;
    case "cloud_access":
      return `cloud-access:${indicator.tooltip}`;
    case "cloud_exposure":
      return `cloud-exposure:${indicator.tooltip}`;
    case "origin":
      return `origin:${indicator.tooltip}`;
    case "automation":
      return "automation";
    case "agent":
      return "agent";
  }
}
