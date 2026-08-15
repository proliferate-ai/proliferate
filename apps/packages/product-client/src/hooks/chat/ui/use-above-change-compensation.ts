import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { ContentHeightScrollAnchor } from "#product/hooks/chat/ui/transcript-row-list-model";

// How long after an older-history prepend the loop keeps re-applying the
// measured scrollHeight delta so the reading row stays fixed while the freshly
// mounted older rows correct their estimated heights. Those corrections arrive
// in spurts spread across several frames — more, and more spread out, on a slow
// or cold CI runner — so a stable-frame / frame-budget termination ends the
// loop a spurt early (3 quiet frames BETWEEN spurts read as "settled") and
// loses the last estimate-to-measured correction: the ~39px under-absorption CI
// caught (chromium 564 vs > 602.4) and, when the loop terminated before the
// first correction even landed, the total anchor miss (webkit 0). A wall-clock
// deadline bounds the loop instead; the delta write is idempotent once the
// height holds, so running spare frames to the deadline is harmless and
// guarantees every correction inside the window is absorbed.
const ABOVE_CHANGE_COMPENSATION_MAX_MS = 500;

function compensationNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

interface UseAboveChangeCompensationParams {
  scrollRef: RefObject<HTMLDivElement | null>;
  pinnedRef: RefObject<boolean>;
  notifyProgrammaticScroll: (write: () => void) => void;
}

// Hold the anchored content in place while a freshly-inserted row above it
// measures in. Re-applies the measured scrollHeight delta each frame (so the
// anchor stays put as the estimate corrects) until a wall-clock deadline lapses
// or the user re-pins.
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
    const deadline = compensationNow() + ABOVE_CHANGE_COMPENSATION_MAX_MS;
    const tick = () => {
      const viewport = scrollRef.current;
      if (!viewport || pinnedRef.current) {
        compensateFrameRef.current = null;
        return;
      }
      notifyProgrammaticScroll(() => {
        viewport.scrollTop = anchor.scrollTop + (viewport.scrollHeight - anchor.scrollHeight);
      });
      if (compensationNow() >= deadline) {
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
