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
      className={`min-h-[calc(1lh+0.5rem)] gap-2 px-2 py-1 text-ui leading-5 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      <div className="flex size-4 shrink-0 items-center justify-center text-sidebar-muted-foreground transition-colors group-hover:text-sidebar-foreground group-focus-visible:text-sidebar-foreground group-data-[active=true]:text-sidebar-foreground [&>svg]:size-full [&>svg]:shrink-0">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 items-center text-ui leading-5 text-current">
        <span className="truncate">{label}</span>
      </div>
      {status ? (
        <span className="ml-auto shrink-0 text-xs leading-4 text-sidebar-muted-foreground">
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
