import { forwardRef, type MouseEventHandler, type ReactNode } from "react";
import { IconButton } from "@/components/ui/IconButton";

interface SidebarActionButtonProps {
  children: ReactNode;
  title: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  alwaysVisible?: boolean;
  active?: boolean;
  disabled?: boolean;
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
  }, ref) {
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
          alwaysVisible ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        } ${className}`}
      >
        {children}
      </IconButton>
    );
  },
);
