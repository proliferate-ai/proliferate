import { forwardRef, type MouseEventHandler, type ReactNode } from "react";

import { RowActionIconButton } from "./RowActionIconButton";

export type SidebarActionButtonVariant = "default" | "section";

export interface SidebarActionButtonProps {
  children: ReactNode;
  title: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  alwaysVisible?: boolean;
  active?: boolean;
  disabled?: boolean;
  variant?: SidebarActionButtonVariant;
}

export const SidebarActionButton = forwardRef<HTMLButtonElement, SidebarActionButtonProps>(
  function SidebarActionButton({
    children,
    title,
    onClick,
    className = "",
    alwaysVisible = false,
    active = false,
    disabled = false,
    variant = "default",
  }, ref) {
    const isAlwaysVisible = alwaysVisible || variant === "section";

    return (
      <RowActionIconButton
        ref={ref}
        label={title}
        onClick={onClick}
        disabled={disabled}
        active={active}
        visibility={isAlwaysVisible ? "always" : "reveal"}
        className={`text-sidebar-muted-foreground hover:text-sidebar-foreground focus-visible:text-sidebar-foreground ${
          variant === "section"
            ? "opacity-75 hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
            : ""
        } ${className}`}
      >
        {children}
      </RowActionIconButton>
    );
  },
);
