import type { HTMLAttributes, ReactNode } from "react";

import { SidebarRowSurface } from "@proliferate/ui/layout/SidebarRowSurface";

export interface ProductSidebarThreadRowProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect"> {
  active?: boolean;
  /**
   * Legacy LEADING-well indicator slot (web row-view consumers). Desktop
   * thread rows put live activity in `trailingStatus` instead, matching the
   * workspace rows' right-slot convention.
   */
  status?: ReactNode;
  label: ReactNode;
  subtitle?: string | null;
  detail?: ReactNode;
  trailingLabel?: string | null;
  /**
   * Activity indicator (spinner / waiting / error) in the TRAILING cell,
   * same precedence as ProductSidebarWorkspaceRow: it wins over
   * `trailingLabel` and fades out on hover/focus like the other trailing
   * content.
   */
  trailingStatus?: ReactNode;
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
  trailingStatus = null,
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
      className={`${hasSubtitle ? "h-[40px]" : "h-[28px]"} pl-2 pr-1 py-1 text-sidebar-row focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      {hoverAction ? (
        <div className="absolute right-0 top-0 z-10 mr-0.5 flex h-full items-center justify-center pr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {hoverAction}
        </div>
      ) : null}
      <div className="flex w-full items-center gap-1.5">
        <div className="flex w-4 shrink-0 items-center justify-center">
          {status}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className={`flex min-w-0 flex-1 ${hasSubtitle ? "flex-col items-start justify-center gap-0.5" : "items-center gap-2"} truncate text-sidebar-foreground`}>
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
          {trailingStatus ? (
            <div className="flex size-5 items-center justify-center transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0">
              {trailingStatus}
            </div>
          ) : trailingLabel && !active && !expandControl ? (
            <div className="truncate text-right text-ui tabular-nums text-sidebar-muted-foreground group-focus-within:opacity-0 group-hover:opacity-0">
              {trailingLabel}
            </div>
          ) : null}
          {expandControl}
        </div>
      </div>
    </SidebarRowSurface>
  );
}
