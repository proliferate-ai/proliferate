import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";

interface SidebarRowSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, "onClick"> {
  children: ReactNode;
  active?: boolean;
  onPress?: () => void;
}

export function SidebarRowSurface({
  children,
  active = false,
  onPress,
  className = "",
  ...props
}: SidebarRowSurfaceProps) {
  const interactive = typeof onPress === "function";

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
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      data-active={active}
      onClick={interactive ? onPress : undefined}
      onKeyDown={handleKeyDown}
      className={`group relative flex w-full min-w-0 items-center rounded-lg transition-colors ${
        interactive ? "cursor-pointer select-none" : ""
      } ${
        active
          ? "bg-sidebar-accent text-foreground"
          : "opacity-75 hover:opacity-100 hover:bg-sidebar-accent text-foreground"
      } ${className}`}
    >
      {children}
    </div>
  );
}
