import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from "react";

import { twMerge } from "#product/primitives/utils/tw-merge";

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
    ? "bg-selected text-sidebar-foreground"
    : disabled
      ? "text-sidebar-muted-foreground"
      : "text-sidebar-foreground hover:bg-hover active:bg-active";

  // A rapid sweep through many rows (e.g. holding a next/prev-workspace
  // shortcut) pins the main thread with a long task per switch, so the
  // browser only manages a handful of paints across the whole sweep. At
  // ~5fps every painted frame catches a still-fading-in bg-selected at
  // ~0 alpha (duration-hover is 120ms) -- the highlight never becomes
  // visible until the sweep stops and a fade finally gets enough frames to
  // finish. There is no frame budget a settle/defer trick can buy back here:
  // an earlier version of this file deferred the active class by one
  // rAF to fix a *different* bug (same-row net-zero flips suppressing the
  // transition entirely), but under this frame-starved path that deferral
  // made things worse -- its own rAF callback could be starved for the same
  // reason, delaying the highlight even further. Instead, activating a row
  // never transitions background-color at all: it paints solid on the very
  // first available frame, so it's visible even at 5fps. Deactivating a row
  // is unaffected by the starvation (it doesn't need to be seen instantly)
  // and keeps the fade so hover/deselect still feels soft.
  const colorTransition = active ? "transition-[color,opacity]" : "transition-[background-color,color,opacity]";

  // Sidebar row geometry (retune): 30px rows, 10px radius (--radius-lg).
  // twMerge so a caller-provided size token (text-sidebar-nav etc.) actually
  // replaces a baseline size instead of fighting it on stylesheet order.
  const rowClassName = twMerge(
    `group relative flex w-full min-w-0 items-center rounded-lg text-left font-control ${colorTransition} duration-hover ${
      interactive ? "cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-ring" : ""
    } ${
      disabled ? "cursor-not-allowed opacity-60" : ""
    } ${stateClass}`,
    className,
  );

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
