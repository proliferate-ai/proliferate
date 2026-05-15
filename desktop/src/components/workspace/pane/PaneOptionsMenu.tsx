import type { ButtonHTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/ui/Button";
import { MoreHorizontal } from "@/components/ui/icons";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@/components/ui/PopoverButton";
import { PaneIconButton } from "./PaneHeader";

export function PaneOptionsMenu({
  label = "Pane options",
  align = "end",
  className = "",
  children,
}: {
  label?: string;
  align?: "start" | "end";
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <PopoverButton
      trigger={(
        <PaneIconButton label={label} tooltip={label}>
          <MoreHorizontal className="size-3.5" />
        </PaneIconButton>
      )}
      align={align}
      className={twMerge("w-44", POPOVER_SURFACE_CLASS, className)}
    >
      {children}
    </PopoverButton>
  );
}

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
  type = "button",
  ...props
}: PaneOptionsMenuItemProps) {
  return (
    <Button
      type={type}
      variant="ghost"
      size="sm"
      className={twMerge(
        "h-7 w-full justify-start gap-2 rounded-lg px-2 py-0 text-xs text-popover-foreground/80 hover:bg-popover-accent hover:text-popover-foreground",
        className,
      )}
      {...props}
    >
      {reserveIconSlot && (
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
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

export function PaneOptionsMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
