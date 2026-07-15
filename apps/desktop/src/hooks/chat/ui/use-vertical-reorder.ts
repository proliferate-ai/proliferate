import { useCallback, useRef, useState } from "react";

export interface VerticalReorderState {
  dragIndex: number | null;
  dropIndex: number | null;
  handleDragStart: (index: number, event: React.PointerEvent) => void;
}

/** Pointer-based reorder mechanics for the composer's small vertical queue. */
export function useVerticalReorder({
  itemCount,
  onReorder,
}: {
  itemCount: number;
  onReorder: (fromIndex: number, toIndex: number) => void;
}): VerticalReorderState {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const itemHeightsRef = useRef<number[]>([]);
  const startYRef = useRef(0);
  const fromIndexRef = useRef(0);
  // Read via ref inside the drag listeners: the queue can shrink mid-drag
  // (a queued prompt dispatches or is deleted), and a closure-captured count
  // would clamp the drop index against the stale, larger list.
  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;

  const handleDragStart = useCallback((index: number, event: React.PointerEvent) => {
    const target = event.currentTarget as HTMLElement;
    const container = target.closest("[data-reorder-container]") as HTMLElement | null;
    if (!container) {
      return;
    }

    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    fromIndexRef.current = index;
    startYRef.current = event.clientY;
    itemHeightsRef.current = Array.from(
      container.querySelectorAll("[data-reorder-item]"),
      (item) => item.getBoundingClientRect().height,
    );
    setDragIndex(index);
    setDropIndex(index);
    let currentDropIndex = index;

    const handleMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startYRef.current;
      const heights = itemHeightsRef.current;
      let nextIndex = fromIndexRef.current;
      let accumulated = 0;

      if (deltaY > 0) {
        for (let candidate = fromIndexRef.current + 1; candidate < heights.length; candidate += 1) {
          accumulated += heights[candidate] ?? 0;
          if (deltaY > accumulated - (heights[candidate] ?? 0) / 2) {
            nextIndex = candidate;
          } else {
            break;
          }
        }
      } else if (deltaY < 0) {
        for (let candidate = fromIndexRef.current - 1; candidate >= 0; candidate -= 1) {
          accumulated -= heights[candidate] ?? 0;
          if (deltaY < accumulated + (heights[candidate] ?? 0) / 2) {
            nextIndex = candidate;
          } else {
            break;
          }
        }
      }

      currentDropIndex = Math.max(0, Math.min(nextIndex, itemCountRef.current - 1));
      setDropIndex(currentDropIndex);
    };

    const handleEnd = () => {
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleEnd);
      target.removeEventListener("pointercancel", handleEnd);
      const fromIndex = fromIndexRef.current;
      setDragIndex(null);
      setDropIndex(null);
      // Re-clamp at drop time: the list may have shrunk after the last move.
      const toIndex = Math.max(0, Math.min(currentDropIndex, itemCountRef.current - 1));
      if (fromIndex !== toIndex) {
        onReorder(fromIndex, toIndex);
      }
    };

    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleEnd);
    target.addEventListener("pointercancel", handleEnd);
  }, [onReorder]);

  return { dragIndex, dropIndex, handleDragStart };
}
