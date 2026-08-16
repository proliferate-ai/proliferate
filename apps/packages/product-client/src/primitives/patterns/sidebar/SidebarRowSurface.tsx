import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from "react";

import { twMerge } from "#product/primitives/utils/tw-merge";

interface SidebarRowSurfaceProps extends Omit<HTMLAttributes<HTMLElement>, "onClick"> {
  children: ReactNode;
  as?: "button" | "div";
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

/**
 * Rapid successive selections can flip `active` true/false/true across several
 * React commits that land faster than the browser paints a frame in between,
 * so the transition's start and end styles are identical at the next paint
 * and it silently never runs. Settling the value one animation frame behind
 * `active` guarantees the previous state is actually painted before we ever
 * commit the flip to the new one, so the transition always has two distinct
 * frames to animate between.
 */
function useSettledActive(active: boolean): boolean {
  const [settled, setSettled] = useState(active);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (active === settled) {
      return undefined;
    }
    frameRef.current = requestAnimationFrame(() => setSettled(active));
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [active, settled]);

  return settled;
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
  const settledActive = useSettledActive(active);
  const interactive = typeof onPress === "function" && !disabled;
  // Hover sits one step below the selected row so a committed selection reads
  // stronger than a transient hover (previously both used the same accent, so
  // hovering any row looked identical to the active one).
  const stateClass = settledActive
    ? "bg-selected text-sidebar-foreground"
    : disabled
      ? "text-sidebar-muted-foreground"
      : "text-sidebar-foreground hover:bg-hover active:bg-active";

  // Sidebar row geometry (retune): 30px rows, 10px radius (--radius-lg).
  // twMerge so a caller-provided size token (text-sidebar-nav etc.) actually
  // replaces a baseline size instead of fighting it on stylesheet order.
  const rowClassName = twMerge(
    `group relative flex w-full min-w-0 items-center rounded-lg text-left font-control transition-[background-color,color,opacity] duration-hover ${
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
