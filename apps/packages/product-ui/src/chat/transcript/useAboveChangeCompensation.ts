import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  GLUE_ABOVE_MAX_FRAMES,
  GLUE_STABLE_FRAMES,
  type ContentHeightScrollAnchor,
} from "./TranscriptRowListShared";

interface UseAboveChangeCompensationParams {
  scrollRef: RefObject<HTMLDivElement | null>;
  pinnedRef: RefObject<boolean>;
  notifyProgrammaticScroll: (write: () => void) => void;
}

// Hold the anchored content in place while a freshly-inserted row above it
// measures in. Re-applies the measured scrollHeight delta each frame (so the
// anchor stays put as the estimate corrects), stopping once the height is
// stable or a frame budget is hit.
export function useAboveChangeCompensation({
  scrollRef,
  pinnedRef,
  notifyProgrammaticScroll,
}: UseAboveChangeCompensationParams) {
  const compensateFrameRef = useRef<number | null>(null);

  const startAboveChangeCompensation = useCallback((anchor: ContentHeightScrollAnchor) => {
    if (typeof window === "undefined") {
      return;
    }
    if (compensateFrameRef.current != null) {
      cancelAnimationFrame(compensateFrameRef.current);
    }
    let lastHeight = -1;
    let stableFrames = 0;
    let totalFrames = 0;
    const tick = () => {
      const viewport = scrollRef.current;
      if (!viewport || pinnedRef.current) {
        compensateFrameRef.current = null;
        return;
      }
      notifyProgrammaticScroll(() => {
        viewport.scrollTop = anchor.scrollTop + (viewport.scrollHeight - anchor.scrollHeight);
      });
      const height = viewport.scrollHeight;
      if (height === lastHeight) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastHeight = height;
      }
      totalFrames += 1;
      if (stableFrames >= GLUE_STABLE_FRAMES || totalFrames >= GLUE_ABOVE_MAX_FRAMES) {
        compensateFrameRef.current = null;
        return;
      }
      compensateFrameRef.current = requestAnimationFrame(tick);
    };
    compensateFrameRef.current = requestAnimationFrame(tick);
  }, [notifyProgrammaticScroll, pinnedRef, scrollRef]);

  useEffect(() => () => {
    if (compensateFrameRef.current != null) {
      cancelAnimationFrame(compensateFrameRef.current);
    }
  }, []);

  return startAboveChangeCompensation;
}
