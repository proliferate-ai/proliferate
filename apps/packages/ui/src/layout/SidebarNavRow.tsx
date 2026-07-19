import type { HTMLAttributes, ReactNode } from "react";

import { ShortcutBadge } from "./ShortcutBadge";
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
  return (
    <SidebarRowSurface
      as="button"
      active={active}
      disabled={disabled}
      onPress={onPress}
      className={`h-[28px] gap-2 px-2 py-1 text-ui leading-5 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      {/* Codex parity: the icon carries the row ink, not a dimmer tier, and
          scales with the label (codex runs 16px icons on 14px text — 1.15em).
          The well matches the icon exactly — a fixed w-4 well leaves more
          slack around smaller icons, silently widening the icon→label gap on
          smaller-text surfaces (settings) vs the main sidebar. */}
      <div className="flex w-[var(--sidebar-primary-icon-size)] shrink-0 items-center justify-center text-current [&>svg]:size-[var(--sidebar-primary-icon-size)] [&>svg]:shrink-0">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 items-center text-current">
        <span className="truncate">{label}</span>
      </div>
      {status ? (
        <span className="ml-auto shrink-0 text-ui-sm text-sidebar-muted-foreground">
          {status}
        </span>
      ) : shortcutLabel ? (
        <ShortcutBadge
          label={shortcutLabel}
          className={`shrink-0 text-sidebar-muted-foreground opacity-0 transition-opacity ${
            shortcutRevealVisible ? "opacity-100" : "group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        />
      ) : null}
    </SidebarRowSurface>
  );
}
