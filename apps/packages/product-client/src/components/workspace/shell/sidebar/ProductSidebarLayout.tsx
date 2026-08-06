import type { ReactNode } from "react";

import { ChevronRight } from "#product/primitives/icons/core";
import { AutoHideScrollArea } from "#product/primitives/patterns/AutoHideScrollArea";
import { SidebarRowSurface } from "#product/primitives/patterns/SidebarRowSurface";

export function ProductSidebarFrame({
  children,
  footer = null,
  className = "",
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex h-full flex-col gap-2 border-r border-border bg-sidebar text-sidebar-foreground select-none ${className}`}>
      {children}
      {footer}
    </div>
  );
}

/**
 * Brand row at the top of the sidebar: product mark + wordmark in
 * the full sidebar ink, sitting above the primary navigation.
 */
export function ProductSidebarBrandRow({
  icon = null,
  label,
}: {
  icon?: ReactNode;
  label: string;
}) {
  return (
    // px-4: the sidebar content grid's left edge is nav-row padding (px-2 on
    // the nav) plus the row surface's own pl-2 — 16px total. The brand row
    // has no nav/row wrapper of its own, so it carries that same 16px here
    // directly, keeping the wordmark flush with the nav icons and section
    // labels below it instead of sitting 8px further left.
    <div className="mb-1 flex h-8 shrink-0 items-center gap-2 px-4 text-sidebar-primary">
      {icon}
      {/* Wordmark geometry: 17px/24 semibold. */}
      <span className="min-w-0 truncate text-sidebar-brand font-semibold">
        {label}
      </span>
    </div>
  );
}

export function ProductSidebarBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {children}
    </div>
  );
}

export function ProductSidebarScrollableContent({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <AutoHideScrollArea
        className="h-full"
        viewportClassName="px-2 pt-0.5 pb-4"
        contentClassName="flex w-full min-w-0 flex-col gap-px"
      >
        {children}
      </AutoHideScrollArea>
    </div>
  );
}

export function ProductSidebarSectionHeader({
  label,
  actions = null,
  collapsed,
  onToggleCollapsed,
}: {
  label: string;
  actions?: ReactNode;
  /**
   * When both are supplied, the ENTIRE header row (label plus the empty
   * space beside it) becomes the section's collapse/expand control — a
   * click anywhere on the row toggles the whole section's body, not just
   * the chevron. The disclosure chevron then sits immediately to the
   * right of the label rather than at the row's far edge. Omit both to
   * keep a purely static, non-interactive header (e.g. Cleanup, which has
   * no collapsible body of its own).
   */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const isToggleable = typeof onToggleCollapsed === "function";
  const labelRow = (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate">{label}</span>
      {isToggleable ? (
        // The disclosure chevron is quiet chrome while the section is open:
        // it only surfaces when the section is collapsed (the one state the
        // user must be able to read at rest) or on hover/keyboard focus.
        <ChevronRight
          className={`icon-compact shrink-0 text-sidebar-muted-foreground/70 transition-[transform,color,opacity] group-hover/side-section:text-sidebar-foreground ${collapsed
            ? ""
            : "rotate-90 opacity-0 group-hover/side-section:opacity-100 group-focus-within/side-section:opacity-100"
            }`}
        />
      ) : null}
    </span>
  );
  const actionsSlot = actions ? (
    // Section actions stay hidden until the header is hovered (or an
    // action's popover is open / focused via keyboard).
    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-hover group-hover/side-section:opacity-100 group-focus-within/side-section:opacity-100 has-[[data-state=open]]:opacity-100">
      {actions}
    </div>
  ) : null;

  if (isToggleable) {
    return (
      // Round-3: the base row surface brings a hover/active background
      // meant for selectable rows — this toggle isn't a selectable row, it's
      // a quiet disclosure control, so the background is neutralized at
      // both rest and hover (bg-transparent wins the same twMerge group as
      // the base's hover:bg-hover/active:bg-active). Hover feedback comes
      // entirely from color: the label lightens toward the full sidebar
      // foreground, and the chevron (above) follows via the shared
      // group-hover/side-section state.
      <SidebarRowSurface
        onPress={onToggleCollapsed}
        aria-expanded={!collapsed}
        // Explicit accessible name: without it the row's name is derived from
        // its contents, which include the hover-action buttons' labels (e.g.
        // "Repositories Add repository Filter") — that made role-based
        // queries for the nested actions ambiguously match the header too.
        aria-label={label}
        className="group/side-section h-auto min-h-7 justify-between gap-2 pl-2 pt-3 pb-1 text-sidebar-row text-sidebar-muted-foreground hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent"
      >
        {labelRow}
        {actionsSlot}
      </SidebarRowSurface>
    );
  }

  return (
    <div className="group/side-section pl-2 pt-3 pb-1 text-sidebar-row text-sidebar-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        {labelRow}
        {actionsSlot}
      </div>
    </div>
  );
}
