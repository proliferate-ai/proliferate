import type { ButtonHTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";

export const PANE_ICON_BUTTON_CLASS =
  "size-6 rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground";

export function PaneHeader({
  left,
  right,
  className = "",
}: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={twMerge(
        "z-20 flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-sidebar-border/70 bg-sidebar-background px-2 text-sidebar-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">{left}</div>
      {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
    </div>
  );
}

interface PaneIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tooltip?: string;
  active?: boolean;
  children: ReactNode;
}

export function PaneIconButton({
  label,
  tooltip,
  active = false,
  className = "",
  children,
  type = "button",
  ...props
}: PaneIconButtonProps) {
  const button = (
    <Button
      type={type}
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className={twMerge(
        PANE_ICON_BUTTON_CLASS,
        active && "bg-sidebar-accent text-sidebar-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );

  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
}
