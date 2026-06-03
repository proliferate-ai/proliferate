import type { ButtonHTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "../primitives/Button";

interface PaneOptionsMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  label: string;
  reserveIconSlot?: boolean;
  trailing?: ReactNode;
}

export function PaneOptionsMenuItem({
  icon,
  label,
  reserveIconSlot = Boolean(icon),
  trailing,
  className = "",
  role,
  type = "button",
  ...props
}: PaneOptionsMenuItemProps) {
  return (
    <Button
      type={type}
      role={role}
      variant="ghost"
      size="sm"
      className={twMerge(
        "group/menu-item min-h-8 w-full justify-start gap-1.5 rounded-lg px-2 py-1.5 text-sm font-normal leading-4 text-popover-foreground hover:bg-list-hover hover:text-popover-foreground focus:bg-list-hover",
        className,
      )}
      {...props}
    >
      {reserveIconSlot && (
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100 [&>svg]:size-3.5 [&>svg]:shrink-0">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing && (
        <span className="shrink-0 text-muted-foreground">{trailing}</span>
      )}
    </Button>
  );
}
