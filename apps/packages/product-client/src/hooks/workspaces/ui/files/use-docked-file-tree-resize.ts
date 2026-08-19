import { useCallback, useState, type KeyboardEvent, type PointerEvent } from "react";
import { FILE_TREE_DOCK_MIN_WIDTH } from "#product/lib/domain/files/file-tree-dock-state";

/** Viewer content never drops below this, so it bounds the dock's maximum. */
export const FILE_VIEWER_CONTENT_MIN_WIDTH = 380;
/** Keyboard resize steps pinned by the dock contract. */
const RESIZE_STEP = 16;
const RESIZE_SHIFT_STEP = 48;

export interface DockedFileTreeResize {
  resizing: boolean;
  minWidth: number;
  maxWidth: number;
  valueNow: number;
  handleResizeStart: (event: PointerEvent) => void;
  handleResizeKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Separator behaviour for the left-anchored docked file tree.
 *
 * This deliberately replaces the deleted overlay-oriented
 * `use-tree-panel-resize` rather than preserving its reversed, right-anchored
 * semantics: the dock sits on the inline-start side of
 * `[data-file-viewer-body]`, so dragging right grows the tree and dragging
 * left shrinks it. The maximum is geometry-derived (`bodyWidth - 380`) so the
 * viewer content floor is never crossed, while the durable lower bound stays
 * the store's 280px.
 */
export function useDockedFileTreeResize({
  bodyWidth,
  effectiveWidth,
  setDesiredWidth,
}: {
  bodyWidth: number;
  effectiveWidth: number;
  setDesiredWidth: (width: number) => void;
}): DockedFileTreeResize {
  const [resizing, setResizing] = useState(false);
  const maxWidth = Math.max(
    FILE_TREE_DOCK_MIN_WIDTH,
    bodyWidth - FILE_VIEWER_CONTENT_MIN_WIDTH,
  );

  const clampWidth = useCallback(
    (nextWidth: number) =>
      Math.min(maxWidth, Math.max(FILE_TREE_DOCK_MIN_WIDTH, nextWidth)),
    [maxWidth],
  );

  const handleResizeStart = useCallback(
    (event: PointerEvent) => {
      event.preventDefault();
      setResizing(true);
      const startX = event.clientX;
      const startWidth = effectiveWidth;

      const handleMove = (moveEvent: globalThis.PointerEvent) => {
        // Dock is inline-start anchored, so dragging right grows it.
        setDesiredWidth(clampWidth(startWidth + (moveEvent.clientX - startX)));
      };
      const handleUp = () => {
        setResizing(false);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [clampWidth, effectiveWidth, setDesiredWidth],
  );

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? RESIZE_SHIFT_STEP : RESIZE_STEP;
      let nextWidth: number | null = null;
      if (event.key === "ArrowRight") {
        nextWidth = effectiveWidth + step;
      } else if (event.key === "ArrowLeft") {
        nextWidth = effectiveWidth - step;
      } else if (event.key === "Home") {
        nextWidth = FILE_TREE_DOCK_MIN_WIDTH;
      } else if (event.key === "End") {
        nextWidth = maxWidth;
      }
      if (nextWidth === null) {
        return;
      }
      event.preventDefault();
      setDesiredWidth(clampWidth(nextWidth));
    },
    [clampWidth, effectiveWidth, maxWidth, setDesiredWidth],
  );

  return {
    resizing,
    minWidth: FILE_TREE_DOCK_MIN_WIDTH,
    maxWidth,
    valueNow: Math.round(effectiveWidth),
    handleResizeStart,
    handleResizeKeyDown,
  };
}
