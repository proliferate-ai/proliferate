import type { HTMLAttributes, ReactNode } from "react";

import { ChevronRight } from "@proliferate/ui/icons";
import { ShortcutBadge } from "@proliferate/ui/primitives/ShortcutBadge";
import { SidebarRowSurface } from "@proliferate/ui/patterns/SidebarRowSurface";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";

import { PrStatusIconOverlay, type PrStatusView } from "../patterns/PrStatusBadge";

export interface ProductSidebarRepoGroupHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick"> {
  label: string;
  count: number;
  collapsed: boolean;
  icon?: ReactNode;
  expandedIcon?: ReactNode;
  hoverIcon?: ReactNode;
  action?: ReactNode;
  onToggleCollapsed: () => void;
}

export function ProductSidebarRepoGroupHeader({
  label,
  count,
  collapsed,
  icon,
  expandedIcon,
  hoverIcon,
  action = null,
  onToggleCollapsed,
  className = "",
  ...props
}: ProductSidebarRepoGroupHeaderProps) {
  const visibleIcon = collapsed ? icon : (expandedIcon ?? icon);
  const hoverIconNode = hoverIcon ?? <ChevronGlyph collapsed={collapsed} />;
  const hasAction = action !== null && action !== undefined;

  return (
    <SidebarRowSurface
      onPress={onToggleCollapsed}
      aria-expanded={!collapsed}
      className={`group/folder-row h-[30px] justify-between overflow-x-hidden py-1 text-sidebar-nav focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 pl-1">
        <span className="relative flex h-7.5 w-7.5 items-center justify-center text-current">
          {visibleIcon ? (
            <span className="flex items-center justify-center group-hover/folder-row:opacity-0">
              {visibleIcon}
            </span>
          ) : null}
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/folder-row:opacity-100">
            {hoverIconNode}
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-current">
          {label}
        </span>

        <div className="relative ml-auto flex h-6 min-w-6 shrink-0 items-center justify-end">
          <span className={`flex size-6 items-center justify-center font-mono text-ui-sm text-sidebar-muted-foreground transition-opacity ${hasAction ? "group-hover/folder-row:opacity-0 group-focus-within/folder-row:opacity-0" : ""
            }`}>
            {count}
          </span>
          {hasAction ? (
            <div className="absolute inset-y-0 right-0 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/folder-row:opacity-100 group-focus-within/folder-row:opacity-100">
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </SidebarRowSurface>
  );
}

export interface ProductSidebarWorkspaceRowProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect"> {
  active?: boolean;
  archived?: boolean;
  /**
   * Activity indicator rendered in the LEADING well, owning it alone when
   * present. Legacy slot kept for row-view consumers (web sidebar); desktop
   * workspace rows put activity in `trailingStatus` instead.
   */
  status?: ReactNode;
  /**
   * Git glyph (PR icon) in the leading well. Decorated by the PR dot when
   * `prStatus` is set (§3.2). Rows without a real PR leave the well empty.
   */
  leadingGlyph?: ReactNode;
  attentionStatus?: ReactNode;
  label: string;
  subtitle?: string | null;
  detail?: ReactNode;
  trailingLabel?: string | null;
  /**
   * Activity indicator (spinner / waiting / error) in the TRAILING cell.
   * Right-slot precedence: shortcut reveal and hover actions win (it fades
   * out like the other trailing content), then `trailingStatus`, then
   * `unreadDot`, then `trailingLabel`.
   */
  trailingStatus?: ReactNode;
  shortcutLabel?: string | null;
  shortcutRevealVisible?: boolean;
  hoverAction?: ReactNode;
  /**
   * PR status rendered as a dot anchored on the idle git glyph
   * Rendered only when present — omit when PR data is not available
   * for the row.
   */
  prStatus?: PrStatusView | null;
  /**
   * Unseen-activity dot in the trailing cell. Yields
   * to `trailingStatus` (live activity wins) and to hover actions.
   */
  unreadDot?: boolean;
  onSelect?: () => void;
}

export function ProductSidebarWorkspaceRow({
  active = false,
  archived = false,
  status = null,
  leadingGlyph = null,
  attentionStatus = null,
  label,
  subtitle = null,
  detail = null,
  trailingLabel = null,
  trailingStatus = null,
  shortcutLabel = null,
  shortcutRevealVisible = false,
  hoverAction = null,
  prStatus = null,
  unreadDot = false,
  onSelect,
  className = "",
  ...props
}: ProductSidebarWorkspaceRowProps) {
  const hasSubtitle = Boolean(subtitle);

  return (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className={`${hasSubtitle ? "h-[40px]" : "h-[30px]"} pl-2 pr-1 py-1 text-sidebar-row focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      {hoverAction ? (
        <div className="absolute right-0 top-0 z-10 mr-0.5 flex h-full items-center justify-center pr-0.5 opacity-0 transition-opacity duration-hover group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
          {hoverAction}
        </div>
      ) : null}
      <div className="flex h-full w-full items-center">
        <div className="flex w-4 shrink-0 items-center justify-center">
          {status ?? (
            <PrStatusIconOverlay status={prStatus}>
              {leadingGlyph}
            </PrStatusIconOverlay>
          )}
        </div>

        {attentionStatus ? (
          <div className="ml-1 flex w-3 shrink-0 items-center justify-center">
            {attentionStatus}
          </div>
        ) : null}

        <div className={`${attentionStatus ? "ml-1" : "ml-1.5"} flex min-w-0 flex-1 items-center gap-2 pl-0.5`}>
          <div className={`flex min-w-0 flex-1 self-stretch ${hasSubtitle ? "flex-col items-start justify-center gap-0.5" : "items-center gap-2"} ${archived ? "text-sidebar-muted-foreground/60" : "text-sidebar-foreground"
            }`}>
            <span
              className={`${hasSubtitle ? "max-w-full" : "min-w-0 flex-1"} truncate select-none`}
              draggable={false}
            >
              {label}
            </span>
            {hasSubtitle ? (
              <span className="max-w-full truncate text-ui-sm text-sidebar-muted-foreground select-none" draggable={false}>
                {subtitle}
              </span>
            ) : null}
          </div>
          {detail ? (
            <div className={`flex min-w-[24px] shrink-0 items-center justify-end gap-1.5 text-sidebar-muted-foreground`}>
              {detail}
            </div>
          ) : null}
        </div>

        {(trailingLabel || trailingStatus || shortcutLabel || hoverAction || unreadDot) ? (
          <div className={`grid h-5 min-w-[26px] shrink-0 items-center justify-items-end ${detail ? "ml-[5px]" : "ml-1.5"
            }`}>

            {trailingStatus ? (
              <div
                className={`col-start-1 row-start-1 flex h-5 items-center justify-end transition-opacity duration-hover ${shortcutLabel && shortcutRevealVisible
                    ? "opacity-0"
                    : "group-hover:opacity-0 group-focus-within:opacity-0"
                  }`}
              >
                {trailingStatus}
              </div>
            ) : unreadDot ? (
              <Tooltip
                content="Unseen activity"
                className={`col-start-1 row-start-1 flex h-5 items-center justify-end transition-opacity duration-hover ${shortcutLabel && shortcutRevealVisible
                    ? "opacity-0"
                    : "group-hover:opacity-0 group-focus-within:opacity-0"
                  }`}
              >
                <span
                  role="img"
                  aria-label="Unseen activity"
                  className="block icon-status rounded-full bg-info/70 text-sidebar-brand"
                />
              </Tooltip>
            ) : trailingLabel ? (
              <div className={`col-start-1 row-start-1 flex items-center justify-end overflow-visible truncate whitespace-nowrap text-right text-ui tabular-nums text-faint transition-opacity duration-hover ${shortcutLabel && shortcutRevealVisible
                  ? "opacity-0"
                  : "group-hover:opacity-0 group-focus-within:opacity-0"
                }`}>
                {trailingLabel}
              </div>
            ) : null}

            {shortcutLabel ? (
              <ShortcutBadge
                label={shortcutLabel}
                className={`col-start-1 row-start-1 h-fit !w-0 shrink-0 text-sidebar-muted-foreground opacity-0 transition-opacity duration-hover ${shortcutRevealVisible ? "opacity-100" : ""
                  }`}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </SidebarRowSurface>
  );
}

function ChevronGlyph({ collapsed }: { collapsed: boolean }) {
  return (
    <ChevronRight
      className={`icon-compact transition-transform ${collapsed ? "" : "rotate-90"}`}
    />
  );
}
