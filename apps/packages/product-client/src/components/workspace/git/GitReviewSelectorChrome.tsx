/**
 * Shared chrome for the git review pane's two popover selectors
 * (`GitReviewBaseSelector`, `GitReviewTargetSelector`). Not a library
 * component — a local helper inside the git area's own feature code, so it
 * needs no index row or registry entry (DESIGN_SYSTEM.md § placement
 * algorithm: a shape shared by exactly two sibling files in one area is a
 * local collapse, not a promotion).
 *
 * The small square count/label chip that used to live here
 * (`GitReviewCountChip`) has been promoted out: counting `LoopsPanel`'s
 * native/emulated chip made it a fourth instance of one shape, so it became
 * `Badge size="micro"` rather than a second local owner in another area.
 * Only the trigger class remains local.
 */

/**
 * The two selectors' trigger buttons were character-identical apart from a
 * width clause. This is the shared base; each caller appends its own width
 * override.
 */
export const GIT_REVIEW_SELECTOR_TRIGGER_CLASS =
  "h-6 min-w-0 gap-1 rounded-lg border border-transparent bg-transparent px-1.5 py-0 text-ui text-sidebar-foreground hover:bg-surface-elevated-secondary hover:text-sidebar-foreground data-[state=open]:bg-surface-elevated-secondary data-[state=open]:text-sidebar-foreground";
