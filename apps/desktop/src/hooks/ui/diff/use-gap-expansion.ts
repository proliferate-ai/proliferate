import { useCallback, useState } from "react";
import type { InterHunkGap } from "@/lib/domain/files/diff-parser";
import type { ExpandDirection } from "@/components/content/ui/diff/DiffContextExpander";
import {
  clampGapReveal,
  resolveGapLineCount,
  type GapExpansionState,
} from "@/lib/domain/files/gap-expansion";

/** Number of lines to reveal per directional expand click */
const EXPAND_STEP = 20;

/**
 * Manages per-gap expansion state, keyed by gap index. Reveal amounts are
 * stored unclamped so expansion requested before file content arrives
 * (lazy fetch) applies correctly once line counts are known.
 */
export function useGapExpansion() {
  const [gapStates, setGapStates] = useState<Map<number, GapExpansionState>>(new Map());

  const expandGap = useCallback(
    (gapIndex: number, _gap: InterHunkGap, direction: ExpandDirection) => {
      setGapStates((prev) => {
        const next = new Map(prev);
        const current = next.get(gapIndex) ?? { revealedTop: 0, revealedBottom: 0 };

        if (direction === "all") {
          next.set(gapIndex, {
            revealedTop: Number.MAX_SAFE_INTEGER,
            revealedBottom: 0,
          });
        } else if (direction === "down") {
          // Expand from top (lines adjacent to hunk above = top of gap)
          next.set(gapIndex, { ...current, revealedTop: current.revealedTop + EXPAND_STEP });
        } else if (direction === "up") {
          // Expand from bottom (lines adjacent to hunk below = bottom of gap)
          next.set(gapIndex, { ...current, revealedBottom: current.revealedBottom + EXPAND_STEP });
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

// Re-export pure domain functions for convenience
export { clampGapReveal, resolveGapLineCount, type GapExpansionState };
