import type { HTMLAttributes, ReactNode } from "react";

import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { SidebarRowSurface } from "./SidebarRowSurface";

interface SidebarNavRowProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect"> {
  icon?: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  status?: ReactNode;
  shortcutLabel?: string;
  shortcutRevealVisible?: boolean;
  onPress: () => void;
}

export function SidebarNavRow({
  icon,
  label,
  active = false,
  disabled = false,
  status,
  shortcutLabel,
  shortcutRevealVisible,
  onPress,
  className = "",
  ...props
}: SidebarNavRowProps) {
  const visibleShortcutLabel = shortcutRevealVisible ? shortcutLabel : null;
  const hasTrailingStatus = status != null;

  return (
    <SidebarRowSurface
      as="button"
      active={active}
      disabled={disabled}
      onPress={onPress}
      className={`h-[30px] gap-2 pl-2 pr-1 py-1 text-ui leading-5 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      {/* The icon carries the row ink, not a dimmer tier, and scales with
          the label (~1.15em icon-to-text).
          The well matches the icon exactly — a fixed w-4 well leaves more
          slack around smaller icons, silently widening the icon→label gap on
          smaller-text surfaces (settings) vs the main sidebar. */}
      <div className="flex w-[var(--icon-paired)] shrink-0 items-center justify-center text-current [&>svg]:icon-indicator [&>svg]:shrink-0">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 items-center text-current">
        <span className="truncate">{label}</span>
      </div>
      {hasTrailingStatus || visibleShortcutLabel ? (
        <span
          data-sidebar-nav-trailing
          className="relative ml-auto shrink-0 text-ui-sm text-sidebar-muted-foreground"
        >
          {hasTrailingStatus ? (
            <span
              data-sidebar-nav-status
              className={visibleShortcutLabel ? "opacity-0" : undefined}
            >
              {status}
            </span>
          ) : null}
          {visibleShortcutLabel ? (
            <ShortcutBadge
              label={visibleShortcutLabel}
              data-sidebar-shortcut-overlay={hasTrailingStatus ? true : undefined}
              className={`shrink-0 text-sidebar-muted-foreground ${
                hasTrailingStatus
                  ? "absolute right-0 top-1/2 -translate-y-1/2"
                  : ""
              }`}
            />
          ) : null}
        </span>
      ) : null}
    </SidebarRowSurface>
  );
}
