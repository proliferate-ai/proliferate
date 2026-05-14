import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";

interface SidebarRowSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, "onClick"> {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export function SidebarRowSurface({
  children,
  active = false,
  disabled = false,
  onPress,
  className = "",
  ...props
}: SidebarRowSurfaceProps) {
  const interactive = typeof onPress === "function" && !disabled;
  const stateClass = active
    ? "bg-sidebar-accent text-sidebar-foreground"
    : disabled
      ? "text-sidebar-foreground/45"
      : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground";

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPress();
    }
  };

  return (
    <div
      {...props}
      role={interactive || disabled ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-disabled={disabled || undefined}
      data-active={active}
      onClick={interactive ? onPress : undefined}
      onKeyDown={handleKeyDown}
      className={`group relative flex w-full min-w-0 items-center rounded-lg transition-[background-color,color,opacity] duration-150 ${
        interactive ? "cursor-pointer select-none" : ""
      } ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      } ${stateClass} ${className}`}
    >
      {children}
    </div>
  );
}
