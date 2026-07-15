import type { ReactNode } from "react";

import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";

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
    <div className={`flex h-full flex-col gap-2 bg-sidebar text-sidebar-foreground select-none ${className}`}>
      {children}
      {footer}
    </div>
  );
}

/**
 * Codex-style brand row at the top of the sidebar: product mark + wordmark in
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
    <div className="mb-1 flex h-8 shrink-0 items-center gap-2 px-4 text-sidebar-primary">
      {icon}
      {/* Codex wordmark geometry: 17px/24 semibold. */}
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
}: {
  label: string;
  actions?: ReactNode;
}) {
  return (
    <div className="group/side-section pl-2 pt-3 pb-1 text-sidebar-row text-sidebar-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {actions ? (
          // Codex parity: section actions stay hidden until the header is
          // hovered (or an action's popover is open / focused via keyboard).
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/side-section:opacity-100 group-focus-within/side-section:opacity-100 has-[[data-state=open]]:opacity-100">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
