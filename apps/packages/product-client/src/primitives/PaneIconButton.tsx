import type { ButtonHTMLAttributes, ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { Button } from "#product/primitives/Button";

export const PANE_ICON_BUTTON_CLASS =
  "size-6 rounded-md text-sidebar-muted-foreground hover:bg-hover hover:text-sidebar-foreground active:bg-active data-[state=open]:bg-active data-[state=open]:text-sidebar-foreground";

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
        active && "bg-active text-sidebar-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}
