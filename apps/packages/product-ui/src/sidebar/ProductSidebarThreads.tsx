import type { HTMLAttributes, ReactNode } from "react";

import { SidebarRowSurface } from "@proliferate/ui/layout/SidebarRowSurface";

export interface ProductSidebarThreadRowProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect"> {
  active?: boolean;
  status?: ReactNode;
  label: ReactNode;
  subtitle?: string | null;
  detail?: ReactNode;
  trailingLabel?: string | null;
  hoverAction?: ReactNode;
  expandControl?: ReactNode;
  onSelect?: () => void;
}

export function ProductSidebarThreadRow({
  active = false,
  status = null,
  label,
  subtitle = null,
  detail = null,
  trailingLabel = null,
  hoverAction = null,
  expandControl = null,
  onSelect,
  className = "",
  ...props
}: ProductSidebarThreadRowProps) {
  const hasSubtitle = Boolean(subtitle);

  return (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className={`${hasSubtitle ? "h-[42px]" : "h-[30px]"} pl-2 pr-1 py-1 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      {hoverAction ? (
        <div className="absolute right-0 top-0 z-10 mr-0.5 flex h-full items-center justify-center pr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {hoverAction}
        </div>
      ) : null}
      <div className="flex w-full items-center gap-1.5 text-sm leading-4">
        <div className="flex w-4 shrink-0 items-center justify-center">
          {status}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className={`flex min-w-0 flex-1 ${hasSubtitle ? "flex-col items-start justify-center gap-0.5" : "items-center gap-2"} truncate text-ui leading-5 text-sidebar-foreground`}>
            <span className="max-w-full truncate">
              {label}
            </span>
            {hasSubtitle ? (
              <span className="max-w-full truncate text-xs leading-3 text-sidebar-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </div>
          {detail ? (
            <div className="flex min-w-[24px] shrink-0 items-center justify-end gap-1 text-sidebar-muted-foreground">
              {detail}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {trailingLabel && !active && !expandControl ? (
            <div className="truncate text-right text-sm leading-4 tabular-nums text-sidebar-muted-foreground group-focus-within:opacity-0 group-hover:opacity-0">
              {trailingLabel}
            </div>
          ) : null}
          {expandControl}
        </div>
      </div>
    </SidebarRowSurface>
  );
}
