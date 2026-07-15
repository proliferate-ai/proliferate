import { useCallback, useRef } from "react";

interface UseResizeOptions {
  /** "horizontal" = drag left/right to change width, "vertical" = drag up/down to change height */
  direction: "horizontal" | "vertical";
  /** Current size of the panel in px — captured on mousedown as the starting value */
  size: number;
  /** Called on every mouse move with the proposed new size in px */
  onResize: (size: number) => void;
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
  onResize,
  reverse = false,
  min = 0,
  max = Infinity,
}: UseResizeOptions) {
  const startRef = useRef({ pos: 0, size: 0 });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startPos = direction === "horizontal" ? e.clientX : e.clientY;
      startRef.current = { pos: startPos, size };

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
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [direction, size, onResize, reverse, min, max],
  );

  return onMouseDown;
}
