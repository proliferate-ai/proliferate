import { useCallback, useState } from "react";
import type { InterHunkGap } from "@/lib/domain/files/diff-parser";
import type { ExpandDirection } from "@/components/content/ui/diff/DiffContextExpander";

/** Number of lines to reveal per directional expand click */
const EXPAND_STEP = 20;

export interface GapExpansionState {
  /** Lines revealed from the top of the gap (adjacent to hunk above) */
  revealedTop: number;
  /** Lines revealed from the bottom of the gap (adjacent to hunk below) */
  revealedBottom: number;
  /** Whether fully expanded */
  fullyExpanded: boolean;
}

/**
 * Manages per-gap expansion state. Expansion is purely client-side using
 * file content lines provided externally. When file content is not available,
 * callers should hide the expander.
 */
export function useGapExpansion() {
  const [gapStates, setGapStates] = useState<Map<number, GapExpansionState>>(new Map());

  const expandGap = useCallback(
    (gapIndex: number, gap: InterHunkGap, direction: ExpandDirection) => {
      setGapStates((prev) => {
        const next = new Map(prev);
        const current = next.get(gapIndex) ?? { revealedTop: 0, revealedBottom: 0, fullyExpanded: false };
        const totalLines = gap.lineCount;

        if (direction === "all" || totalLines <= 0) {
          next.set(gapIndex, { revealedTop: totalLines, revealedBottom: 0, fullyExpanded: true });
        } else if (direction === "down") {
          // Expand from top (lines adjacent to hunk above = top of gap)
          const newTop = Math.min(current.revealedTop + EXPAND_STEP, totalLines - current.revealedBottom);
          const fullyExpanded = newTop + current.revealedBottom >= totalLines;
          next.set(gapIndex, { ...current, revealedTop: newTop, fullyExpanded });
        } else if (direction === "up") {
          // Expand from bottom (lines adjacent to hunk below = bottom of gap)
          const newBottom = Math.min(current.revealedBottom + EXPAND_STEP, totalLines - current.revealedTop);
          const fullyExpanded = current.revealedTop + newBottom >= totalLines;
          next.set(gapIndex, { ...current, revealedBottom: newBottom, fullyExpanded });
        }
        return next;
      });
    },
    [],
  );

  const getGapState = useCallback(
    (gapIndex: number): GapExpansionState | undefined => gapStates.get(gapIndex),
    [gapStates],
  );

  return { gapStates, expandGap, getGapState };
}
