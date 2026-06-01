import type { ReactNode } from "react";

import type { SidebarActionEvent, SidebarActionView } from "./ProductSidebarModel";
import { SidebarActionIconButton } from "./ProductSidebarActionButton";

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
