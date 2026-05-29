import { useEffect, useState } from "react";
import { Platform } from "react-native";

const MIN_SOFT_KEYBOARD_INSET = 80;

export function useVisualViewportKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    const visualViewport = viewport;

    let frame: number | null = null;
    let lastInset = -1;

    function readInset() {
      const nextInset = calculateKeyboardInset(visualViewport);
      if (nextInset === lastInset) {
        return;
      }
      lastInset = nextInset;
      setInset(nextInset);
    }

    function scheduleRead() {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        readInset();
      });
    }

    readInset();
    visualViewport.addEventListener("resize", scheduleRead);
    visualViewport.addEventListener("scroll", scheduleRead);
    window.addEventListener("resize", scheduleRead);
    window.addEventListener("orientationchange", scheduleRead);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      visualViewport.removeEventListener("resize", scheduleRead);
      visualViewport.removeEventListener("scroll", scheduleRead);
      window.removeEventListener("resize", scheduleRead);
      window.removeEventListener("orientationchange", scheduleRead);
    };
  }, []);

  return inset;
}

function calculateKeyboardInset(viewport: VisualViewport): number {
  const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
  const viewportBottom = viewport.offsetTop + viewport.height;
  const rawInset = Math.max(0, layoutHeight - viewportBottom);

  if (rawInset < MIN_SOFT_KEYBOARD_INSET) {
    return 0;
  }

  return Math.round(rawInset);
}
