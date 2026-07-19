import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
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
  /** React 19 ref-as-prop; lands on the underlying button element. */
  ref?: Ref<HTMLButtonElement>;
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
  // (text-base), 16px icons promoting muted → prominent on hover; spacing
  // stays fixed (px 10 / py 5 at default density).
  //
  // Hover promotion is expressed as a COLOR change (`text-current/75` →
  // `text-current`, a color-mix on currentColor), never as an `opacity`
  // change: animating `opacity` on always-visible glyphs creates/collapses a
  // compositing layer whose re-rasterization flips text/icon anti-aliasing on
  // every hover and reads as shimmer/jitter (styling.md "No partial-opacity
  // hover transitions on glyphs"). `text-current/*` keeps currentColor
  // inheritance intact so tinted rows (e.g. `text-destructive`) still color
  // their icon.
  // justify-center: the column is taller than its content (min-h-7), so
  // without it rows render top-aligned — icon/label sit above the visual
  // center of the hover pill.
  const outerClassName = density === "compact"
    ? "group/menu-item flex min-h-7 w-full cursor-pointer select-none flex-col justify-center rounded-lg px-2 py-1 text-ui-sm font-normal text-popover-foreground outline-none transition-colors disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
    : "group/menu-item flex min-h-7 w-full cursor-pointer select-none flex-col justify-center rounded-lg px-2.5 py-[5px] text-ui-sm font-normal text-popover-foreground outline-none transition-colors disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent";
  const rowClassName = density === "compact"
    ? "flex w-full items-center gap-1.5"
    : "flex w-full items-center gap-1.5";
  const glyphHoverPromotion =
    "text-current/75 transition-colors group-hover/menu-item:text-current group-focus/menu-item:text-current";
  // translate-y: optical compensation. SF's ink center sits ~0.3px below the
  // line-box center, so box-centered glyphs read slightly high next to text;
  // nudging the icon (not the text) keeps text antialiasing crisp.
  const defaultIconClassName =
    `flex size-4 shrink-0 translate-y-[0.5px] items-center justify-center ${glyphHoverPromotion}`;
  const trailingHoverPromotion =
    "text-muted-foreground/75 transition-colors group-hover/menu-item:text-muted-foreground group-focus/menu-item:text-muted-foreground";
  const defaultTrailingClassName = density === "compact"
    ? `flex size-5 shrink-0 items-center justify-center ${trailingHoverPromotion}`
    : `flex shrink-0 items-center justify-center ${trailingHoverPromotion}`;

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
