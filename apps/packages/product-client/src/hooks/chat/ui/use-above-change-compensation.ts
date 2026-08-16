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
  /**
   * Timestamp of the last genuine upward user scroll intent (see
   * use-transcript-stick-to-bottom). For a CANCELABLE compensation window (a
   * completed-turn split, see below), an upward gesture arriving AFTER the
   * window opens cancels the remaining per-frame re-anchoring so an unpinned
   * reader scrolling up is never dragged back per-frame; the active gesture
   * wins (platform precedent: CSS scroll anchoring suppresses adjustments
   * during user scroll). Intent predating the window does not cancel.
   */
  userScrollUpIntentAtRef: RefObject<number>;
}

// Hold the anchored content in place while a freshly-inserted row above it
// measures in. Re-applies the measured scrollHeight delta each frame (so the
// anchor stays put as the estimate corrects) until a wall-clock deadline lapses
// or the user re-pins.
export function useAboveChangeCompensation({
  scrollRef,
  pinnedRef,
  notifyProgrammaticScroll,
  userScrollUpIntentAtRef,
}: UseAboveChangeCompensationParams) {
  const compensateFrameRef = useRef<number | null>(null);

  // `cancelableByUpwardIntent` is true ONLY for the completed-turn split: an
  // autonomous insertion above an unpinned reader, where an active upward
  // gesture must win over per-frame re-anchoring. It is FALSE for a history
  // prepend, which the reader REQUESTED by scrolling to the top: there the
  // added-above content must keep the reading row fixed even as the same
  // upward gesture continues (the reader is loading and reading older history),
  // so the window is immune to the upward-intent cancel.
  const startAboveChangeCompensation = useCallback((
    anchor: ContentHeightScrollAnchor,
    cancelableByUpwardIntent: boolean,
  ) => {
    if (typeof window === "undefined") {
      return;
    }
    if (compensateFrameRef.current != null) {
      cancelAnimationFrame(compensateFrameRef.current);
    }
    const startedAt = compensationNow();
    const deadline = startedAt + ABOVE_CHANGE_COMPENSATION_MAX_MS;
    const tick = () => {
      const viewport = scrollRef.current;
      if (!viewport || pinnedRef.current) {
        compensateFrameRef.current = null;
        return;
      }
      // Genuine upward user intent that arrived AFTER this window opened wins
      // for a cancelable (completed-turn) window: stop re-anchoring so the
      // active gesture is never fought per-frame. Intent predating the window
      // never cancels; a prepend window is never cancelable.
      if (cancelableByUpwardIntent && userScrollUpIntentAtRef.current > startedAt) {
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
  }, [notifyProgrammaticScroll, pinnedRef, scrollRef, userScrollUpIntentAtRef]);

  useEffect(() => () => {
    if (compensateFrameRef.current != null) {
      cancelAnimationFrame(compensateFrameRef.current);
    }
  }, []);

  return startAboveChangeCompensation;
}
