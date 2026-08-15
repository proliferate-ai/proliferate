/**
 * Shared indent formula for the file tree's two row renderers
 * (`FileTreeRow.tsx`'s per-row `paddingLeft` and `FileTreeDirectory.tsx`'s
 * compact status-line `paddingLeft`). One owner for the `6px` base plus
 * `14px`-per-level step keeps the tree row and the loading/empty/error line
 * underneath it aligned at every level without repeating the literal.
 */
const FILE_TREE_INDENT_BASE_PX = 6;
const FILE_TREE_INDENT_STEP_PX = 14;

export function fileTreeIndentPaddingLeft(level: number): number {
  return FILE_TREE_INDENT_BASE_PX + level * FILE_TREE_INDENT_STEP_PX;
}
