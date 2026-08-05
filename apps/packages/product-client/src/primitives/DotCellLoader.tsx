import type { HTMLAttributes } from "react";

export type DotCellLoaderVariant = "wave" | "orbit" | "scan" | "helix" | "breathe";
export type DotCellLoaderSize = "compact" | "default";

export interface DotCellLoaderProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  variant?: DotCellLoaderVariant;
  size?: DotCellLoaderSize;
}

/**
 * Nine-dot activity cell used where a ring spinner is too visually heavy.
 * Shared CSS owns the geometry, timing, and reduced-motion behavior.
 */
export function DotCellLoader({
  variant = "wave",
  size = "default",
  className = "",
  ...props
}: DotCellLoaderProps) {
  return (
    <span
      className={`dot-cell-loader ${className}`}
      data-dot-cell-loader
      data-size={size}
      data-variant={variant}
      {...props}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="dot-cell-loader__dot"
        />
      ))}
    </span>
  );
}
