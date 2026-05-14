import type { HTMLAttributes, ReactNode } from "react";
import { ShortcutBadge } from "@/components/ui/ShortcutBadge";
import { SidebarRowSurface } from "@/components/ui/SidebarRowSurface";

interface SidebarNavRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onClick"> {
  icon?: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  status?: ReactNode;
  shortcutLabel?: string;
  onPress: () => void;
}

const SIDEBAR_NAV_ROW_CLASS =
  "h-[30px] gap-1.5 px-2 py-1 text-sm leading-4 focus-visible:outline-offset-[-2px]";
const SIDEBAR_NAV_STATUS_CLASS =
  "ml-auto shrink-0 text-xs leading-4 text-sidebar-muted-foreground";

export function SidebarNavRow({
  icon,
  label,
  active = false,
  disabled = false,
  status,
  shortcutLabel,
  onPress,
  className = "",
  ...props
}: SidebarNavRowProps) {
  return (
    <SidebarRowSurface
      active={active}
      disabled={disabled}
      onPress={onPress}
      className={`${SIDEBAR_NAV_ROW_CLASS} ${active ? "font-medium" : ""} ${className}`}
      {...props}
    >
      <div className="flex w-4 shrink-0 items-center justify-center">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 items-center text-base leading-5 text-sidebar-foreground">
        <span className="truncate">{label}</span>
      </div>
      {status ? (
        <span className={SIDEBAR_NAV_STATUS_CLASS}>{status}</span>
      ) : shortcutLabel ? (
        <ShortcutBadge
          label={shortcutLabel}
          className="shrink-0 text-sidebar-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        />
      ) : null}
    </SidebarRowSurface>
  );
}
