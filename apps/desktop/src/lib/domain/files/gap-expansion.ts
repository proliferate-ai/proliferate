import type { InterHunkGap } from "@/lib/domain/files/diff-parser";

export interface GapExpansionState {
  /**
   * Lines requested from the top of the gap (adjacent to hunk above).
   * Unclamped — viewers clamp against the gap's actual line count at
   * render time (counts may be unknown until file content is fetched).
   */
  revealedTop: number;
  /** Lines requested from the bottom of the gap (adjacent to hunk below) */
  revealedBottom: number;
}

/**
 * Clamp raw reveal amounts against the gap's actual line count.
 * Returns effective top/bottom line counts plus whether the gap is
 * fully consumed.
 */
export function clampGapReveal(
  state: GapExpansionState,
  totalLines: number,
): { top: number; bottom: number; fullyExpanded: boolean } {
  if (totalLines <= 0) {
    return { top: 0, bottom: 0, fullyExpanded: false };
  }
  const top = Math.min(state.revealedTop, totalLines);
  const bottom = Math.min(state.revealedBottom, totalLines - top);
  return { top, bottom, fullyExpanded: top + bottom >= totalLines };
}

/**
 * Resolve a gap with unknown line count (-1, trailing gap) against the
 * fetched file's total line count. Returns null when the gap turns out
 * to be empty, or when the count is unknown and file content has not
 * been fetched yet — a separator must never render without a number.
 */
export function resolveGapLineCount(
  gap: InterHunkGap,
  fileLines: string[] | undefined,
): InterHunkGap | null {
  if (gap.lineCount >= 0) {
    return gap.lineCount === 0 ? null : gap;
  }
  if (!fileLines) {
    return null;
  }
  // Trailing file content often ends with a newline, producing one empty
  // trailing element from split("\n") that is not a real line.
  const totalNewLines =
    fileLines.length > 0 && fileLines[fileLines.length - 1] === ""
      ? fileLines.length - 1
      : fileLines.length;
  const lineCount = totalNewLines - gap.newStartLine + 1;
  if (lineCount <= 0) {
    return null;
  }
  return { ...gap, lineCount };
}
