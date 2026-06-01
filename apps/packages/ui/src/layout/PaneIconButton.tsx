import type { ButtonHTMLAttributes, ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "../primitives/Button";

export const PANE_ICON_BUTTON_CLASS =
  "size-6 rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground";

interface PaneIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  children: ReactNode;
}

export function PaneIconButton({
  label,
  active = false,
  className = "",
  children,
  type = "button",
  ...props
}: PaneIconButtonProps) {
  return (
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
}
