import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { twMerge } from "../utils/tw-merge";

export type PopoverMenuItemVariant = "default" | "sidebar";
export type PopoverMenuItemDensity = "default" | "compact";

export interface PopoverMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  variant?: PopoverMenuItemVariant;
  density?: PopoverMenuItemDensity;
  iconClassName?: string;
  labelClassName?: string;
  trailingClassName?: string;
}

export function PopoverMenuItem({
  icon,
  label,
  trailing,
  variant = "default",
  density = "default",
  iconClassName = "",
  labelClassName = "",
  trailingClassName = "",
  className = "",
  children,
  role,
  type = "button",
  onClick,
  ...props
}: PopoverMenuItemProps) {
  const hoverClassName = variant === "sidebar"
    ? "hover:bg-sidebar-accent focus:bg-sidebar-accent"
    : "hover:bg-list-hover focus:bg-list-hover";
  const hasDescription = children !== undefined && children !== null && children !== false;
  // Codex menu-row recipe (reference/codex main_chat_view + popover dumps):
  // 12px rows (text-ui-sm) in full row foreground, 11px muted hints
  // (text-base), 16px icons inheriting currentColor at 75%→100% opacity;
  // spacing stays fixed (px 10 / py 5 at default density).
  const outerClassName = density === "compact"
    ? "group/menu-item flex min-h-7 w-full cursor-pointer select-none flex-col rounded-lg px-2 py-1 text-ui-sm font-normal text-popover-foreground outline-none transition-colors disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
    : "group/menu-item flex min-h-7 w-full cursor-pointer select-none flex-col rounded-lg px-2.5 py-[5px] text-ui-sm font-normal text-popover-foreground outline-none transition-colors disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent";
  const rowClassName = density === "compact"
    ? "flex w-full items-center gap-1.5"
    : "flex w-full items-center gap-1.5";
  const defaultIconClassName =
    "flex size-4 shrink-0 items-center justify-center opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100";
  const defaultTrailingClassName = density === "compact"
    ? "flex size-5 shrink-0 items-center justify-center text-muted-foreground opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100"
    : "flex shrink-0 items-center justify-center text-muted-foreground opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100 [&_*]:text-base";

  return (
    <button
      type={type}
      role={role}
      className={twMerge(
        outerClassName,
        hoverClassName,
        className,
      )}
      {...props}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <span className={rowClassName}>
        {icon && (
          <span className={twMerge(defaultIconClassName, iconClassName)}>
            {icon}
          </span>
        )}
        <span className={twMerge("min-w-0 flex-1 truncate text-left", labelClassName)}>{label}</span>
        {trailing && (
          <span className={twMerge(defaultTrailingClassName, trailingClassName)}>
            {trailing}
          </span>
        )}
      </span>
      {hasDescription && (
        <span className={`mt-0.5 flex w-full items-center gap-2 ${icon ? "pl-6" : ""}`}>
          <span className="min-w-0 flex-1 text-left text-base text-muted-foreground [&>*]:!mt-0 [&_*]:text-base">
            {children}
          </span>
        </span>
      )}
    </button>
  );
}
