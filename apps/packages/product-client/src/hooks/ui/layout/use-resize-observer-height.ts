import { useCallback, useRef, useState } from "react";

/**
 * Measures the live height of a CONDITIONALLY-MOUNTED element.
 *
 * Deliberately a callback ref, not the object-ref + `useLayoutEffect([])`
 * pattern used by the width sibling (`useResizeObserverWidth`): that pattern
 * only attaches its observer once, at the CALLING component's own mount, and
 * never re-fires if the target element mounts/unmounts/remounts later on a
 * ref that was null at that first effect run. Consumers here (the
 * background-work transcript row, mounted only while `hasBackgroundWork`)
 * need the observer to re-attach every time the node itself mounts, which a
 * callback ref does for free — React invokes it on every attach/detach.
 */
export function useResizeObserverHeight<T extends HTMLElement>(): {
  ref: (node: T | null) => void;
  height: number;
} {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node) {
      return;
    }

    setHeight(node.getBoundingClientRect().height);

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setHeight(entry?.contentRect.height ?? node.getBoundingClientRect().height);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return { ref, height };
}
