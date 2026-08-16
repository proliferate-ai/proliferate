import { useCallback, useRef, useState, type RefObject } from "react";
import { DIRECTION_EPSILON_PX } from "#product/hooks/chat/ui/transcript-row-list-model";

export interface TranscriptNewContentSignal {
  /**
   * True when content grew (a real ResizeObserver-measured resize, not an
   * estimate) while unpinned: drives the scroll-to-latest button's
   * new-content variant (Q18, rung 9).
   */
  hasNewContentWhileUnpinned: boolean;
  /** Live read for synchronous checks inside effects/cleanup (no re-render). */
  hasNewContentWhileUnpinnedRef: RefObject<boolean>;
  /** Announcement consumed: the reader reached the bottom (any re-pin path). */
  clearNewContentSignal: () => void;
  /**
   * Feed one content-resize observation. `scrollHeight` is the model's own
   * measured height (the single ResizeObserver, rung 4), never an estimate.
   * A shrink (row collapse) does not raise the signal: nothing NEW was added
   * for the reader to jump to.
   */
  notifyContentGrew: (scrollHeight: number, pinned: boolean) => void;
  /** Session switch: drop both the signal and its growth baseline. */
  reset: () => void;
}

/**
 * Owns the Q18 new-content-while-unpinned signal as its own seam so
 * useTranscriptStickToBottom.ts (capped near 400 lines, PRO-187) does not
 * grow past its cap to carry a single derived boolean.
 */
export function useTranscriptNewContentSignal(): TranscriptNewContentSignal {
  const hasNewContentWhileUnpinnedRef = useRef(false);
  const [hasNewContentWhileUnpinned, setHasNewContentWhileUnpinned] = useState(false);
  const lastResizeContentHeightRef = useRef(0);

  const clearNewContentSignal = useCallback(() => {
    if (!hasNewContentWhileUnpinnedRef.current) {
      return;
    }
    hasNewContentWhileUnpinnedRef.current = false;
    setHasNewContentWhileUnpinned(false);
  }, []);

  const notifyContentGrew = useCallback((scrollHeight: number, pinned: boolean) => {
    const grew = scrollHeight - lastResizeContentHeightRef.current > DIRECTION_EPSILON_PX;
    if (!pinned && grew) {
      hasNewContentWhileUnpinnedRef.current = true;
      setHasNewContentWhileUnpinned(true);
    }
    lastResizeContentHeightRef.current = scrollHeight;
  }, []);

  const reset = useCallback(() => {
    lastResizeContentHeightRef.current = 0;
    clearNewContentSignal();
  }, [clearNewContentSignal]);

  return {
    hasNewContentWhileUnpinned,
    hasNewContentWhileUnpinnedRef,
    clearNewContentSignal,
    notifyContentGrew,
    reset,
  };
}
