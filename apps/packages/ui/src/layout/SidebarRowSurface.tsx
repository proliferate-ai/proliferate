import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from "react";

interface SidebarRowSurfaceProps extends Omit<HTMLAttributes<HTMLElement>, "onClick"> {
  children: ReactNode;
  as?: "button" | "div";
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

export function SidebarRowSurface({
  children,
  as = "div",
  active = false,
  disabled = false,
  onPress,
  className = "",
  ...props
}: SidebarRowSurfaceProps) {
  const interactive = typeof onPress === "function" && !disabled;
  // Hover sits one step below the selected row so a committed selection reads
  // stronger than a transient hover (previously both used the same accent, so
  // hovering any row looked identical to the active one).
  const stateClass = active
    ? "bg-sidebar-accent text-sidebar-foreground"
    : disabled
      ? "text-sidebar-muted-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/70";

  // Codex sidebar row geometry (UX spec §0.1): 30px rows, 10px radius.
  const rowClassName = `group relative flex w-full min-w-0 items-center rounded-[10px] text-left font-[430] transition-[background-color,color,opacity] duration-150 ${
    interactive ? "cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-ring" : ""
  } ${
    disabled ? "cursor-not-allowed opacity-60" : ""
  } ${stateClass} ${className}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPress();
    }
  };

  if (as === "button") {
    const buttonProps = props as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button
        {...buttonProps}
        type={buttonProps.type ?? "button"}
        disabled={disabled}
        data-active={active}
        onClick={interactive ? onPress : undefined}
        className={rowClassName}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      {...props}
      role={interactive || disabled ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-disabled={disabled || undefined}
      data-active={active}
      onClick={interactive ? onPress : undefined}
      onKeyDown={handleKeyDown}
      className={rowClassName}
    >
      {children}
    </div>
  );
}
