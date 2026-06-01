import type { ReactNode } from "react";

import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";

import type { SidebarActionEvent, SidebarActionView } from "./ProductSidebarModel";
import { SidebarActionIconButton } from "./ProductSidebarActionButton";

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
    <div className={`flex h-full flex-col gap-2 bg-sidebar pb-2 text-sidebar-foreground select-none ${className}`}>
      {children}
      {footer}
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

export function ProductSidebarHeader({
  brand,
  title,
  headerLeadingAction,
  headerAction,
  onAction,
}: {
  brand?: ReactNode;
  title?: string;
  headerLeadingAction?: SidebarActionView | null;
  headerAction?: SidebarActionView | null;
  onAction: (event: SidebarActionEvent) => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-3">
      {headerLeadingAction ? (
        <SidebarActionIconButton
          action={headerLeadingAction}
          scope="header"
          onAction={onAction}
          alwaysVisible
        />
      ) : null}
      {brand ? (
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground">
          {brand}
        </div>
      ) : null}
      {title ? (
        <div className="min-w-0 flex-1 truncate text-base leading-5 text-sidebar-foreground">
          {title}
        </div>
      ) : <div className="min-w-0 flex-1" />}
      {headerAction ? (
        <SidebarActionIconButton
          action={headerAction}
          scope="header"
          onAction={onAction}
          alwaysVisible
        />
      ) : null}
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
    <div className="pl-2 pt-3 pb-1 text-base leading-5 text-sidebar-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="opacity-75">{label}</span>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
