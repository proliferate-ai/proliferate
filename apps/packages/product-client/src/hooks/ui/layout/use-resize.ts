import { useCallback, useEffect, useRef } from "react";

interface UseResizeOptions {
  /** "horizontal" = drag left/right to change width, "vertical" = drag up/down to change height */
  direction: "horizontal" | "vertical";
  /** Current size of the panel in px — captured on mousedown as the starting value */
  size: number;
  /**
   * Resolves the starting size at mousedown instead of `size`, for panels
   * whose rendered size can sit away from the tracked value (e.g. a
   * CSS-clamped width). Seeding from the rendered size keeps the separator
   * under the pointer from the first pixel of the gesture.
   */
  resolveSize?: () => number;
  /** Called on every mouse move with the proposed new size in px */
  onResize: (size: number) => void;
  /**
   * Called once when the gesture ends — the mouseup, or the owner unmounting
   * mid-drag. Lets a consumer treat the drag as one gesture (e.g. persist the
   * final size once) instead of reacting to every intermediate move.
   */
  onResizeEnd?: () => void;
  /** If true, dragging right/down shrinks (for panels anchored to right/bottom edge) */
  reverse?: boolean;
  min?: number;
  max?: number;
}

/**
 * Returns a mousedown handler to attach to a separator element.
 * Handles cursor overlay during drag, clamping, and direction math.
 */
export function useResize({
  direction,
  size,
  resolveSize,
  onResize,
  onResizeEnd,
  reverse = false,
  min = 0,
  max = Infinity,
}: UseResizeOptions) {
  const startRef = useRef({ pos: 0, size: 0 });
  // Holds whatever the in-flight drag needs torn down (listeners + the cursor
  // overlay). A drag that ends via mouseup clears this itself; this ref exists
  // for the drag that never gets a mouseup — the owning panel unmounting
  // mid-gesture (a workspace switch, an error boundary, session teardown) —
  // so the unmount effect below has something to call.
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startPos = direction === "horizontal" ? e.clientX : e.clientY;
      startRef.current = { pos: startPos, size: resolveSize?.() ?? size };

      const cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      const overlay = document.createElement("div");
      overlay.style.cssText = `position:fixed;inset:0;z-index:9999;cursor:${cursor}`;
      document.body.appendChild(overlay);

      const handleMouseMove = (ev: MouseEvent) => {
        const current = direction === "horizontal" ? ev.clientX : ev.clientY;
        const delta = current - startRef.current.pos;
        const newSize = reverse
          ? startRef.current.size - delta
          : startRef.current.size + delta;
        const clamped = Math.min(max, Math.max(min, newSize));
        onResize(clamped);
      };

      const handleMouseUp = () => {
        overlay.remove();
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        activeDragCleanupRef.current = null;
        onResizeEnd?.();
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      activeDragCleanupRef.current = handleMouseUp;
    },
    [direction, size, resolveSize, onResize, onResizeEnd, reverse, min, max],
  );

  // Mirrors handleMouseUp's teardown without firing onResize or removing the
  // listeners twice: a normal mouseup already nulls the ref before this could
  // ever run for that gesture, so this only fires for the unmount-mid-drag
  // case handleMouseUp was never going to see. Ending via unmount still fires
  // onResizeEnd — the gesture is over either way, and a consumer persisting
  // the final size must not lose it just because the surface went away.
  useEffect(() => () => {
    activeDragCleanupRef.current?.();
  }, []);

  return onMouseDown;
}
