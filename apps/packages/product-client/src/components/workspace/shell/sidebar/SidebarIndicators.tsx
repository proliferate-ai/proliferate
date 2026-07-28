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
  // One shared tier for every activity state: the waiting clock, the running
  // spinner, and the error/warning badge must render at the same size so the
  // trailing cell never appears to jump as a row moves between states. The
  // reference draws these at 14px against the 12px row text — exactly
  // --icon-indicator; --icon-control (16px) reads visibly oversized there.
  switch (indicator.kind) {
    case "error":
      return <CircleAlert className="icon-indicator text-destructive" />;
    case "worktree_missing":
      return <CircleAlert className="icon-indicator text-warning-foreground" />;
    case "waiting_input":
    case "waiting_plan":
      return <Clock className="icon-indicator text-info" />;
    case "iterating":
    case "queued_prompt":
      return <Spinner className="icon-indicator text-sidebar-foreground" />;
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

  // Both branches occupy the same fixed 20px cell (h-5 min-w-5, centered) so
  // the glyph's vertical center is identical whether or not the indicator is
  // actionable — mixed cell sizes are what made adjacent rows' indicators sit
  // at visibly different heights.
  return (
    <Tooltip content={indicator.tooltip} className="flex h-5 min-w-5 shrink-0 items-center justify-center">
      {action && onAction ? (
        <IconButton
          tone="sidebar"
          size="sm"
          title={indicator.tooltip}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onAction(action);
          }}
          className="!size-5 !p-0 hover:bg-transparent"
        >
          {glyph}
        </IconButton>
      ) : (
        <span role="img" aria-label={indicator.tooltip} className="flex h-5 min-w-5 items-center justify-center">{glyph}</span>
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

/**
 * One tier for the whole trailing detail cluster: `icon-tight` (0.875em).
 *
 * These are metadata ABOUT the row — where the workspace is materialized
 * (local / worktree / cloud / SSH target), who can reach it, whether an
 * automation drives it. They sit one tier below the row's own text so the
 * workspace name leads and the cluster is read second; at `icon-compact` (the
 * row text's own size) they carried the same optical weight as the name and the
 * cluster competed with it. `icon-tight` is also exactly what the row's
 * trailing CONTROLS already draw at (SidebarActionButton and the workspace
 * kebab both pin `[&_svg]:icon-tight`), so the trailing edge now reads as one
 * coherent size instead of two.
 *
 * Every value stays em-relative against `--text-sidebar-row`, so the cluster
 * shrinks and grows with the UI font-size preference rather than pinning px.
 */
const DETAIL_GLYPH_TIER_CLASS = "icon-tight";

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
          className={`${DETAIL_GLYPH_TIER_CLASS} [font-size:var(--text-sidebar-row)] ${className}`}
        />
      </Tooltip>
    );
  }

  if (indicator.kind === "cloud_access" || indicator.kind === "cloud_exposure") {
    const glyph = indicator.kind === "cloud_access"
      ? <CircleUser className={DETAIL_GLYPH_TIER_CLASS} />
      : <Globe className={DETAIL_GLYPH_TIER_CLASS} />;
    return (
      <Tooltip content={indicator.tooltip} className="inline-flex shrink-0 items-center justify-center">
        <span className={detailToneClass(indicator.tone, className)}>
          {glyph}
        </span>
      </Tooltip>
    );
  }

  const glyph = indicator.kind === "automation"
    ? <BotMessageSquare className={DETAIL_GLYPH_TIER_CLASS} />
    : indicator.kind === "agent"
      ? <MessageSquare className={DETAIL_GLYPH_TIER_CLASS} />
      : <ArrowRight className={DETAIL_GLYPH_TIER_CLASS} />;
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
      return "text-warning-foreground";
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
