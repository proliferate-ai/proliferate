import type { ButtonHTMLAttributes, ReactNode } from "react";

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
  type = "button",
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
    >
      {icon && <span className="flex shrink-0 items-center justify-center">{icon}</span>}
      <span className="flex-1 truncate text-left">{label}</span>
      {trailing && <span className="flex shrink-0 items-center justify-center">{trailing}</span>}
    </button>
  );
}
