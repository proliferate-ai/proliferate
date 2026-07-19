import { useCallback, useState, type KeyboardEvent, type RefObject } from "react";
import {
  FILE_TREE_MAX_WIDTH_RATIO,
  FILE_TREE_MIN_WIDTH,
} from "#product/stores/editor/file-tree-store";

/**
 * Drag-resize for the right-anchored file tree panel: dragging the left
 * edge leftwards grows the panel, clamped between FILE_TREE_MIN_WIDTH and
 * a ratio of the containing pane's width.
 */
export function useTreePanelResize({
  panelRef,
  width,
  setWidth,
}: {
  panelRef: RefObject<HTMLElement | null>;
  width: number;
  setWidth: (width: number) => void;
}) {
  const [resizing, setResizing] = useState(false);

  const clampWidth = useCallback((nextWidth: number) => {
    const measuredPaneWidth = panelRef.current?.parentElement?.clientWidth ?? 0;
    const paneWidth = measuredPaneWidth > 0 ? measuredPaneWidth : 1000;
    return Math.min(
      paneWidth * FILE_TREE_MAX_WIDTH_RATIO,
      Math.max(FILE_TREE_MIN_WIDTH, nextWidth),
    );
  }, [panelRef]);

  const handleResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      setResizing(true);
      const startX = event.clientX;
      const startWidth = width;

      const handleMove = (moveEvent: PointerEvent) => {
        // Panel is right-anchored, so dragging left grows it.
        setWidth(clampWidth(startWidth + (startX - moveEvent.clientX)));
      };

      const handleUp = () => {
        setResizing(false);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [clampWidth, width, setWidth],
  );

  const handleResizeKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 48 : 16;
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") {
      nextWidth = width + step;
    } else if (event.key === "ArrowRight") {
      nextWidth = width - step;
    } else if (event.key === "Home") {
      nextWidth = FILE_TREE_MIN_WIDTH;
    } else if (event.key === "End") {
      nextWidth = Number.POSITIVE_INFINITY;
    }
    if (nextWidth === null) {
      return;
    }
    event.preventDefault();
    setWidth(clampWidth(nextWidth));
  }, [clampWidth, setWidth, width]);

  return { resizing, handleResizeStart, handleResizeKeyDown };
}
