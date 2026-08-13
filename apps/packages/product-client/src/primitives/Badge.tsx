import { forwardRef, type HTMLAttributes } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "info"
  | "warning"
  | "destructive"
  | "sidebar";

/**
 * Geometry, with one tone exception. `default` is the bordered pill; `micro`
 * is the square count/label chip that sits inside dense chrome (popover
 * triggers, roster meta lines) — tighter radius and padding, and no visible
 * edge (the border stays for the box model, painted transparent).
 *
 * The exception: `neutral` at `micro` swaps its fill from the pill's
 * `surface-control` chrome to the flat `muted` step, because an edgeless chip
 * needs a fill that reads on its own. That single cross-product cell is
 * deliberate and load-bearing — both chips this size was promoted from
 * painted `bg-muted`. Every other tone keeps its own tint and ink unchanged
 * at either size, so `tone` and `size` are otherwise independent.
 */
export type BadgeSize = "default" | "micro";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-control text-muted-foreground",
  accent: "border-border/70 bg-surface-control text-accent-foreground",
  success: "border-success/25 bg-success/10 text-success",
  info: "border-info/25 bg-info/10 text-info",
  warning: "border-warning-border bg-warning-subtle text-warning-foreground",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  sidebar: "border-border bg-surface-control text-sidebar-muted-foreground",
};

const sizeClasses: Record<BadgeSize, string> = {
  default: "rounded-full px-2 py-0.5",
  micro: "rounded-sm border-transparent px-1 py-0.5 leading-none",
};

/** Micro's neutral fill is the flat `muted` step, not the default pill's control chrome. */
const MICRO_NEUTRAL_FILL = "bg-muted";

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  function Badge({ tone = "neutral", size = "default", className = "", ...props }, ref) {
    return (
      <span
        ref={ref}
        className={twMerge(
          "inline-flex max-w-full items-center border text-ui-sm font-medium",
          toneClasses[tone],
          sizeClasses[size],
          size === "micro" && tone === "neutral" ? MICRO_NEUTRAL_FILL : "",
          className,
        )}
        {...props}
      />
    );
  },
);
