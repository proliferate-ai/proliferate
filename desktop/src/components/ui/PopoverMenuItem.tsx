import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

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
    ? "hover:bg-sidebar-accent focus:bg-sidebar-accent"
    : "hover:bg-popover-accent focus:bg-popover-accent";
  const hasDescription = children !== undefined && children !== null && children !== false;

  return (
    <button
      type={type}
      className={twMerge(
        "group/menu-item flex w-full cursor-default select-none flex-col rounded-lg px-2.5 py-1.5 text-sm font-[430] leading-5 text-popover-foreground outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
        hoverClassName,
        className,
      )}
      {...props}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <span className="flex w-full items-center gap-2">
        {icon && (
          <span className="flex shrink-0 items-center justify-center text-muted-foreground">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {trailing && (
          <span className="flex shrink-0 items-center justify-center text-muted-foreground opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100 [&_*]:text-xs [&_*]:leading-4">
            {trailing}
          </span>
        )}
      </span>
      {hasDescription && (
        <span className={`mt-0.5 flex w-full items-center gap-2 ${icon ? "pl-6" : ""}`}>
          <span className="min-w-0 flex-1 text-left text-sm leading-5 text-muted-foreground [&_*]:text-sm [&_*]:leading-5">
            {children}
          </span>
        </span>
      )}
    </button>
  );
}
