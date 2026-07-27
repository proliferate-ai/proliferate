import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "@proliferate/design/motion";

export interface ClosingHeaderTab {
  id: string;
  left: number;
  width: number;
}

/**
 * Keeps a just-closed tab on screen for one exit duration so the close reads as
 * a slide instead of a snap.
 *
 * The real tab leaves `shellRows` immediately — that is what lets every
 * surviving tab (and the trailing "+" button, which tracks the strip's measured
 * content width) translate into the vacated space. A non-interactive ghost is
 * painted at the departing tab's last known geometry and collapses in place
 * over the same duration, so the two halves of the motion are simultaneous.
 */
export function useHeaderTabCloseTransition() {
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

  const beginClose = useCallback((tab: ClosingHeaderTab) => {
    if (tab.width <= 0) {
      return;
    }
    setClosingTabs((current) => [
      ...current.filter((entry) => entry.id !== tab.id),
      tab,
    ]);

    const existing = timeoutsRef.current.get(tab.id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const handle = window.setTimeout(() => {
      timeoutsRef.current.delete(tab.id);
      setClosingTabs((current) => current.filter((entry) => entry.id !== tab.id));
    }, motion.duration.enterMs);
    timeoutsRef.current.set(tab.id, handle);
  }, []);

  return { closingTabs, beginClose };
}
