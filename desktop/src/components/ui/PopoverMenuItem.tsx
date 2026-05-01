import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

type PopoverMenuItemVariant = "default" | "sidebar";

interface PopoverMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
  variant?: PopoverMenuItemVariant;
}

export function PopoverMenuItem({
  icon,
  label,
  trailing,
  variant = "default",
  className = "",
  children,
  type = "button",
  onClick,
  ...props
}: PopoverMenuItemProps) {
  const hoverClassName = variant === "sidebar"
    ? "hover:bg-sidebar-accent"
    : "hover:bg-accent";

  return (
    <button
      type={type}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground transition-colors ${hoverClassName} disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent ${className}`}
      {...props}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      {icon && <span className="flex shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate">{label}</span>
        {children}
      </span>
      {trailing && <span className="flex shrink-0 items-center justify-center">{trailing}</span>}
    </button>
  );
}
