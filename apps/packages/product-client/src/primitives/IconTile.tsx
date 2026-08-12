import { forwardRef, type HTMLAttributes } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

export type IconTileTone = "control" | "outlined" | "elevated" | "warning";
export type IconTileSize = "sm" | "md" | "lg";

interface IconTileProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: IconTileTone;
  size?: IconTileSize;
}

// Container steps as evidenced across the tree (24 / 32 / 40px). The stray 28px
// and 36px one-offs round to the nearest step when their call sites adopt this
// tile — a fourth step would make the axis a scale rather than a variant set.
// Radius rides the size step ("radius grows with the element", DESIGN_SYSTEM.md
// § Radii) instead of becoming a third axis.
const tileSizeClasses: Record<IconTileSize, string> = {
  sm: "size-6 rounded-md",
  md: "size-8 rounded-md",
  lg: "size-10 rounded-lg",
};

// Each tone is a whole paint recipe carrying its own border decision, the way
// `Badge` tones do. That keeps "bordered" out of the prop surface as a third
// orthogonal axis.
const tileToneClasses: Record<IconTileTone, string> = {
  control: "bg-surface-control text-muted-foreground",
  outlined: "border border-border-light bg-surface-control text-muted-foreground",
  elevated: "bg-surface-elevated-secondary text-muted-foreground",
  warning: "bg-warning-subtle text-warning-foreground",
};

/**
 * The icon-in-tinted-tile shape: one glyph centered in a rounded tinted square.
 * Non-interactive by construction — a static tint plate, so it owns no
 * hover/active/focus states and never becomes a button. Wrap it, or put the
 * glyph in `IconButton`/`RowActionIconButton`, when the shape must be pressed.
 *
 * Two variant axes only: `tone` (paint recipe) and `size` (container step).
 *
 * The glyph is a slot: pass a `primitives/icons` glyph carrying its own
 * semantic `icon-*` tier. The tile sets `text-*`, so a `currentColor` glyph
 * picks up the tone's ink without restating it.
 *
 * incubating: chat/workflows slices, wave 2 — the harness, repo-setup, billing,
 * and transcript call sites recorded in the promotion evidence adopt it there.
 * No call-site migration lands with this file.
 */
export const IconTile = forwardRef<HTMLSpanElement, IconTileProps>(
  function IconTile({ tone = "control", size = "md", className = "", ...props }, ref) {
    return (
      <span
        ref={ref}
        data-icon-tile=""
        className={twMerge(
          "inline-flex shrink-0 items-center justify-center",
          tileSizeClasses[size],
          tileToneClasses[tone],
          className,
        )}
        {...props}
      />
    );
  },
);
