import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keyboard/pointer highlight state shared by the composer's inline menus
 * (slash commands and `@` file mentions).
 *
 * Both menus are the same interaction: a vertical list anchored above the
 * composer, driven by Arrow keys with Enter/Tab committing the highlighted row
 * and the pointer taking over the highlight on hover. Keeping one
 * implementation is what keeps the two menus from drifting apart.
 */
export function useComposerMenuNavigation({
  open,
  query,
  itemCount,
}: {
  open: boolean;
  query: string;
  itemCount: number;
}) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = itemCount === 0 ? 0 : Math.min(highlightedIndex, itemCount - 1);

  useEffect(() => {
    if (!open) {
      rowRefs.current = [];
    }
    setHighlightedIndex(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [open, query, itemCount]);

  const moveHighlight = useCallback((delta: number) => {
    if (itemCount === 0) {
      return;
    }
    const next = Math.max(0, Math.min(activeIndex + delta, itemCount - 1));
    if (next === activeIndex) {
      return;
    }
    setHighlightedIndex(next);
    rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, itemCount]);

  const setRowRef = useCallback((index: number, element: HTMLButtonElement | null) => {
    rowRefs.current[index] = element;
  }, []);

  const handleRowMouseEnter = useCallback((index: number) => {
    setHighlightedIndex(index);
  }, []);

  return {
    highlightedIndex: activeIndex,
    listRef,
    moveHighlight,
    setRowRef,
    handleRowMouseEnter,
  };
}
