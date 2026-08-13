import type { ReactNode } from "react";

/**
 * Shared chrome for the git review pane's two popover selectors
 * (`GitReviewBaseSelector`, `GitReviewTargetSelector`). Not a library
 * component — a local helper inside the git area's own feature code, so it
 * needs no index row or registry entry (DESIGN_SYSTEM.md § placement
 * algorithm: a shape shared by exactly two sibling files in one area is a
 * local collapse, not a promotion).
 */

/**
 * The two selectors' trigger buttons were character-identical apart from a
 * width clause. This is the shared base; each caller appends its own width
 * override.
 */
export const GIT_REVIEW_SELECTOR_TRIGGER_CLASS =
  "h-6 min-w-0 gap-1 rounded-lg border border-transparent bg-transparent px-1.5 py-0 text-ui text-sidebar-foreground hover:bg-surface-elevated-secondary hover:text-sidebar-foreground data-[state=open]:bg-surface-elevated-secondary data-[state=open]:text-sidebar-foreground";

/**
 * The small square count/label chip: `GitReviewBaseSelector`'s trigger and
 * option-row changed-count badges, and `GitReviewTargetSelector`'s "default"
 * branch badge, were three drifted spellings of one shape (differing only in
 * radius, padding and whether they carried `tabular-nums`). One owner here
 * keeps them from drifting further; `LoopsPanel.tsx`'s native/emulated chip
 * is a fourth instance in a different area and is deliberately NOT folded in
 * here — merging across areas is a promotion, out of scope for this slice
 * (recorded as a promotion candidate).
 */
export function GitReviewCountChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-muted px-1 py-0.5 text-ui-sm font-medium leading-none tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}
