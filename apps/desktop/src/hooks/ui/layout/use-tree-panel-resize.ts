import { useCallback, useState, type RefObject } from "react";
import {
  FILE_TREE_MAX_WIDTH_RATIO,
  FILE_TREE_MIN_WIDTH,
} from "@/stores/editor/file-tree-store";

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

  const handleResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      setResizing(true);
      const startX = event.clientX;
      const startWidth = width;

      const handleMove = (moveEvent: PointerEvent) => {
        const paneWidth = panelRef.current?.parentElement?.clientWidth ?? 1000;
        const maxWidth = paneWidth * FILE_TREE_MAX_WIDTH_RATIO;
        // Panel is right-anchored, so dragging left grows it.
        const newWidth = Math.min(
          maxWidth,
          Math.max(FILE_TREE_MIN_WIDTH, startWidth + (startX - moveEvent.clientX)),
        );
        setWidth(newWidth);
      };

      const handleUp = () => {
        setResizing(false);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [panelRef, width, setWidth],
  );

  return { resizing, handleResizeStart };
}
