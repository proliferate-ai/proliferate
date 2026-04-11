import { forwardRef, type MouseEventHandler, type ReactNode } from "react";
import { IconButton } from "@/components/ui/IconButton";

type SidebarActionButtonVariant = "default" | "section";

interface SidebarActionButtonProps {
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
      <IconButton
        ref={ref}
        tone="sidebar"
        size="sm"
        title={title}
        onClick={onClick}
        disabled={disabled}
        className={`size-6 rounded-md border border-transparent transition-all ${
          active ? "bg-sidebar-accent/60 text-sidebar-foreground" : ""
        } ${
          isAlwaysVisible ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        } ${
          variant === "section"
            ? "opacity-75 hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
            : ""
        } ${className}`}
      >
        {children}
      </IconButton>
    );
  },
);
