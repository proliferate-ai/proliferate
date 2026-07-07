import { useCallback, useRef, useState } from "react";

export interface VerticalReorderState {
  dragIndex: number | null;
  dropIndex: number | null;
  handleDragStart: (index: number, event: React.PointerEvent) => void;
}

/**
 * Lightweight pointer-event-based vertical reorder for small lists.
 * Returns drag/drop indices for visual feedback and invokes `onReorder`
 * when the user releases at a different position.
 */
export function useVerticalReorder(options: {
  itemCount: number;
  onReorder: (fromIndex: number, toIndex: number) => void;
}): VerticalReorderState {
  const { itemCount, onReorder } = options;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const itemHeightsRef = useRef<number[]>([]);
  const startYRef = useRef(0);
  const fromIndexRef = useRef(0);

  const handleDragStart = useCallback(
    (index: number, event: React.PointerEvent) => {
      const target = event.currentTarget as HTMLElement;
      const container = target.closest("[data-reorder-container]") as HTMLElement | null;
      if (!container) return;

      event.preventDefault();
      target.setPointerCapture(event.pointerId);
      fromIndexRef.current = index;
      startYRef.current = event.clientY;

      // Snapshot item heights for hit-testing.
      const items = container.querySelectorAll("[data-reorder-item]");
      itemHeightsRef.current = Array.from(items).map((el) => el.getBoundingClientRect().height);

      setDragIndex(index);
      setDropIndex(index);

      const dropRef = { current: index };

      const handleMove = (moveEvent: PointerEvent) => {
        const deltaY = moveEvent.clientY - startYRef.current;
        const heights = itemHeightsRef.current;
        let newIndex = fromIndexRef.current;
        let accumulated = 0;

        if (deltaY > 0) {
          for (let i = fromIndexRef.current + 1; i < heights.length; i++) {
            accumulated += heights[i];
            if (deltaY > accumulated - heights[i] / 2) {
              newIndex = i;
            } else {
              break;
            }
          }
        } else if (deltaY < 0) {
          for (let i = fromIndexRef.current - 1; i >= 0; i--) {
            accumulated -= heights[i];
            if (deltaY < accumulated + heights[i] / 2) {
              newIndex = i;
            } else {
              break;
            }
          }
        }

        const clamped = Math.max(0, Math.min(newIndex, itemCount - 1));
        dropRef.current = clamped;
        setDropIndex(clamped);
      };

      const handleEnd = () => {
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleEnd);
        target.removeEventListener("pointercancel", handleEnd);

        const finalFrom = fromIndexRef.current;
        const finalTo = dropRef.current;
        setDragIndex(null);
        setDropIndex(null);

        if (finalFrom !== finalTo) {
          onReorder(finalFrom, finalTo);
        }
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleEnd);
      target.addEventListener("pointercancel", handleEnd);
    },
    [itemCount, onReorder],
  );

  return {
    dragIndex,
    dropIndex,
    handleDragStart,
  };
}
