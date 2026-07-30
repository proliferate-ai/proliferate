import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * Keyboard/pointer highlight state shared by the composer's inline menus
 * (slash commands and `@` file mentions).
 *
 * Both menus are the same interaction: a vertical list anchored above the
 * composer, driven by Arrow keys with Enter/Tab committing the highlighted row
 * and the pointer taking over the highlight on hover. Keeping one
 * implementation is what keeps the two menus from drifting apart.
 *
 * The hook also owns row `id`s: focus never leaves the composer's
 * contenteditable, so the highlighted row is announced to assistive tech via
 * `aria-activedescendant` on that editable pointing at a row rendered
 * elsewhere in the DOM, rather than via native focus.
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
  const idPrefix = useId();
  const getRowId = useCallback((index: number) => `${idPrefix}row-${index}`, [idPrefix]);

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
    getRowId,
    /** Row id for the composer's `aria-activedescendant`, or undefined when nothing is open to announce. */
    activeDescendantId: open && itemCount > 0 ? getRowId(activeIndex) : undefined,
  };
}
