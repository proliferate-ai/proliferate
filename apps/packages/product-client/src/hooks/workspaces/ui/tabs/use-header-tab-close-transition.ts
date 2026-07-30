import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "@proliferate/design/motion";
import type { HeaderWorkspaceShellStripRow } from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

export interface ClosingHeaderTab {
  id: string;
  left: number;
  width: number;
}

/**
 * The row model for a tab close.
 *
 * Owns three things that have to agree with each other:
 *
 * 1. **Departing-tab bookkeeping.** The real tab leaves the row model the
 *    instant it is closed — that is what lets every surviving tab translate
 *    into the vacated space. A ghost entry keeps its last measured geometry
 *    alive for exactly one exit duration so the departure is visible.
 * 2. **Ghost geometry.** `beginCloseChatTab` resolves the closing tab's index
 *    in the strip's rows and freezes the layout's `left`/`width` for it, since
 *    both are gone from the layout by the next render.
 * 3. **Strip width.** The trailing "+" button is a flex sibling of the scroll
 *    strip, so it moves because the strip's measured content width shrinks,
 *    not by transform. `contentWidth` is therefore derived here alongside the
 *    ghosts, and the CSS transitions it on the same duration and curve.
 */
export function useHeaderTabCloseTransition({
  shellRows,
  positions,
  widths,
}: {
  shellRows: readonly HeaderWorkspaceShellStripRow[];
  positions: readonly number[];
  widths: readonly number[];
}) {
  const [closingTabs, setClosingTabs] = useState<readonly ClosingHeaderTab[]>([]);
  const timeoutsRef = useRef(new Map<string, number>());

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const handle of timeouts.values()) {
        window.clearTimeout(handle);
      }
      timeouts.clear();
    };
  }, []);

  const contentWidth = useMemo(() => (
    widths.length > 0
      ? (positions[positions.length - 1] ?? 0) + (widths[widths.length - 1] ?? 0)
      : 0
  ), [positions, widths]);

  const beginCloseChatTab = useCallback((sessionId: string) => {
    const closingIndex = shellRows.findIndex((shellRow) =>
      shellRow.kind === "chat"
      && shellRow.row.kind === "tab"
      && shellRow.row.tab.id === sessionId
    );
    if (closingIndex < 0) {
      return;
    }
    const width = widths[closingIndex] ?? 0;
    if (width <= 0) {
      return;
    }
    const ghost: ClosingHeaderTab = {
      id: sessionId,
      left: positions[closingIndex] ?? 0,
      width,
    };
    setClosingTabs((current) => [
      ...current.filter((entry) => entry.id !== sessionId),
      ghost,
    ]);

    const existing = timeoutsRef.current.get(sessionId);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const handle = window.setTimeout(() => {
      timeoutsRef.current.delete(sessionId);
      setClosingTabs((current) => current.filter((entry) => entry.id !== sessionId));
    }, motion.duration.enterMs);
    timeoutsRef.current.set(sessionId, handle);
  }, [positions, shellRows, widths]);

  return { closingTabs, contentWidth, beginCloseChatTab };
}
