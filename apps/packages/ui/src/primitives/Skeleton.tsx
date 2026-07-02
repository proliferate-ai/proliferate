import type { CSSProperties } from "react";
import { twMerge } from "../utils/tw-merge";

export interface SkeletonBlockProps {
  className?: string;
  /**
   * Row staggering: pass `{ "--shimmer-delay": "120ms" }` (as CSSProperties)
   * to offset this block's shimmer sweep from its siblings.
   */
  style?: CSSProperties;
}

/**
 * Loading placeholder block. Motion comes from the shared `.skeleton-shimmer`
 * class (design css): a codex-style gradient band sweeping via transform —
 * compositor-only, same motion family as the thinking-text indicator.
 */
export function SkeletonBlock({ className, style }: SkeletonBlockProps) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={twMerge("skeleton-shimmer block rounded-md bg-muted/60", className)}
    />
  );
}
