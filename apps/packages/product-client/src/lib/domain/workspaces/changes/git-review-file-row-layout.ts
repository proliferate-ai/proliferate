// The review document renders each file as a flat section on the plain pane
// background — unchanged diff lines carry no tint (the [data-git-review-document]
// rules in design product.css flatten the context surface to match).
export const SIDEBAR_DIFF_SURFACE_STYLE = {
  "--diff-view-surface-override": "var(--color-background)",
} as const;

// Header row (min-h-9 + py) height estimate for content-visibility sizing.
const REVIEW_CARD_HEADER_ESTIMATE_PX = 38;

/**
 * Off-screen review cards skip layout/paint via content-visibility:auto —
 * without it every diff row of every file stays painted and long change
 * lists starve the WKWebView compositor (black flashes while scrolling).
 *
 * Full-height layout: diffs render at natural height (no inner 24-line
 * viewport cap), so the intrinsic-size estimate uses the full expected
 * line count (changed lines + ~50% context) rather than the old capped
 * value. This keeps the outer panel scrollbar stable for off-screen cards.
 */
export function reviewCardVirtualizationStyle({
  collapsed,
  changedLines,
}: {
  collapsed: boolean;
  changedLines: number;
}) {
  // Estimate total rendered lines: changed lines + ~50% context lines.
  // No cap — diffs render full height in this layout variant.
  const estimatedLines = collapsed
    ? 0
    : Math.ceil(Math.max(changedLines, 1) * 1.5);
  return {
    contentVisibility: "auto" as const,
    containIntrinsicSize: `auto calc(${REVIEW_CARD_HEADER_ESTIMATE_PX}px + var(--diffs-line-height) * ${estimatedLines})`,
  };
}
