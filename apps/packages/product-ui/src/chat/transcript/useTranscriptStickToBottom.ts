import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Classification of a viewport scroll event: our own snap vs the user. */
export interface TranscriptScrollSample {
  programmatic: boolean;
}
import { resolveVirtualBottomDistance } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import {
  DIRECTION_EPSILON_PX,
  GLUE_MAX_FRAMES,
  GLUE_STABLE_FRAMES,
  PROGRAMMATIC_MATCH_TOL_PX,
  REPIN_BOTTOM_THRESHOLD_PX,
  SCROLLABLE_OVERFLOW_EPSILON_PX,
} from "./TranscriptRowListShared";

/**
 * Whether the viewport actually has room to scroll. The pre-emptive
 * intent-to-leave listeners must not unpin when the content fits entirely in the
 * viewport: that gesture produces no scroll event, so `onViewportScroll` never
 * runs to re-pin, leaving the engine stuck unpinned and the scroll-to-bottom
 * button wrongly visible while already at the bottom.
 */
function viewportCanScroll(viewport: HTMLDivElement): boolean {
  return viewport.scrollHeight - viewport.clientHeight > SCROLLABLE_OVERFLOW_EPSILON_PX;
}

export interface UseTranscriptStickToBottomOptions {
  /** The real scroll element ref (AutoHideScrollArea forwards its viewport here). */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Perf probe; must run on every scroll, user or programmatic. */
  onScrollSample: (sample?: TranscriptScrollSample) => void;
  /** px from the bottom within which a user scroll re-pins. */
  repinThresholdPx?: number;
  /**
   * Manual-only scroll range created by cards overlaying the transcript. Auto
   * follow stops before this range until the user explicitly reaches the hard
   * bottom or clicks the scroll-to-bottom button.
   */
  autoFollowBottomInsetPx?: number;
}

export interface TranscriptStickToBottom {
  /** True while pinned to the bottom; drives the scroll-to-bottom button. */
  isPinnedToBottom: boolean;
  /** Live pin state for synchronous reads inside effects/cleanup (no re-render). */
  pinnedRef: RefObject<boolean>;
  /** Wire to AutoHideScrollArea's onViewportScroll. Owns stickiness + direction + onScrollSample. */
  onViewportScroll: (viewport: HTMLDivElement) => void;
  /** Snap to the active follow target (soft overlay bottom or user-chosen hard bottom). */
  scrollToBottom: () => void;
  /** Snap + re-pin, for the scroll-to-bottom button. */
  handleScrollToBottomClick: () => void;
  /** Wrap ANY external scrollTop/scrollToOffset write so its scroll event is excluded from pin/direction. */
  notifyProgrammaticScroll: (write: () => void) => void;
  /** Force the pin state (history prepend / anchor restore intentionally unpin to hold the user's position). */
  setPinned: (pinned: boolean) => void;
  /** Reset all tracking and re-pin for a session/workspace switch. */
  resetForSession: () => void;
}

/**
 * Single stick-to-bottom engine shared by the full and virtualized transcript
 * lists. Distinguishes user scrolls from its own programmatic snaps so a
 * streaming snap cannot fight a user scrolling up, re-pins only within a tight
 * bottom band, and collapses a tab/window-resume measurement backlog into one
 * jump instead of a visible crawl.
 */
export function useTranscriptStickToBottom({
  scrollRef,
  onScrollSample,
  repinThresholdPx = REPIN_BOTTOM_THRESHOLD_PX,
  autoFollowBottomInsetPx = 0,
}: UseTranscriptStickToBottomOptions): TranscriptStickToBottom {
  const pinnedRef = useRef(true);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const lastScrollTopRef = useRef(0);
  const programmaticRef = useRef<{ expectedTop: number; frame: number } | null>(null);
  const glueFrameRef = useRef<number | null>(null);
  const autoFollowBottomInsetRef = useRef(Math.max(0, autoFollowBottomInsetPx));
  const consumedAutoFollowBottomInsetRef = useRef(0);

  const setPinned = useCallback((next: boolean) => {
    if (pinnedRef.current === next) {
      return;
    }
    pinnedRef.current = next;
    setIsPinnedToBottom(next);
  }, []);

  const markNonUserScrollPosition = useCallback((viewport: HTMLDivElement) => {
    const expectedTop = viewport.scrollTop;
    if (programmaticRef.current?.frame != null) {
      cancelAnimationFrame(programmaticRef.current.frame);
    }
    // Watchdog: a write that changes nothing (or a browser clamp whose event
    // never arrives) must not leak its marker into the next user scroll.
    // Identity-check the marker so synchronous test rAF implementations stay
    // safe even before the real frame id has been assigned.
    const marker: { expectedTop: number; frame: number } = { expectedTop, frame: 0 };
    programmaticRef.current = marker;
    marker.frame = requestAnimationFrame(() => {
      if (programmaticRef.current === marker) {
        programmaticRef.current = null;
      }
    });
    lastScrollTopRef.current = expectedTop;
  }, []);

  const notifyProgrammaticScroll = useCallback((write: () => void) => {
    const viewport = scrollRef.current;
    write();
    if (!viewport) {
      return;
    }
    markNonUserScrollPosition(viewport);
  }, [markNonUserScrollPosition, scrollRef]);

  // Registered before consumer layout effects. Preserve however much of an
  // existing overlay range the user deliberately consumed; if another card is
  // stacked above the composer, only the NEW height remains manual-only.
  useLayoutEffect(() => {
    const previousInset = autoFollowBottomInsetRef.current;
    const previousConsumedInset = consumedAutoFollowBottomInsetRef.current;
    const nextInset = Math.max(0, autoFollowBottomInsetPx);
    const viewport = scrollRef.current;

    // Removing consumed overlay range can make the browser clamp scrollTop
    // upward to the new hard bottom. Mark that queued scroll event as
    // non-user so its negative delta cannot disable pinned auto-follow.
    if (
      nextInset < previousInset &&
      previousConsumedInset > 0 &&
      pinnedRef.current &&
      viewport
    ) {
      const top = viewport.scrollTop;
      const distanceFromHardBottom = resolveVirtualBottomDistance({
        scrollOffset: top,
        viewportSize: viewport.clientHeight,
        totalVirtualSize: viewport.scrollHeight,
      });
      if (
        top < lastScrollTopRef.current - DIRECTION_EPSILON_PX &&
        distanceFromHardBottom <= PROGRAMMATIC_MATCH_TOL_PX
      ) {
        markNonUserScrollPosition(viewport);
      }
    }

    consumedAutoFollowBottomInsetRef.current = Math.min(previousConsumedInset, nextInset);
    autoFollowBottomInsetRef.current = nextInset;
  }, [autoFollowBottomInsetPx, markNonUserScrollPosition, scrollRef]);

  const scrollToBottom = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }
    // Pin against the real DOM scroll height, never virtualizer.scrollToIndex:
    // index scrolling positions by the *estimated* size of unmeasured rows
    // (e.g. the row appended by this very update) and visibly bounces when the
    // measurement corrects a frame later.
    notifyProgrammaticScroll(() => {
      viewport.scrollTop = resolveAutoFollowScrollTop(
        viewport,
        autoFollowBottomInsetRef.current,
        consumedAutoFollowBottomInsetRef.current,
      );
    });
  }, [notifyProgrammaticScroll, scrollRef]);

  const handleScrollToBottomClick = useCallback(() => {
    consumedAutoFollowBottomInsetRef.current = autoFollowBottomInsetRef.current;
    setPinned(true);
    scrollToBottom();
  }, [scrollToBottom, setPinned]);

  const onViewportScroll = useCallback((viewport: HTMLDivElement) => {
    const top = viewport.scrollTop;
    const previousTop = lastScrollTopRef.current;
    lastScrollTopRef.current = top;

    const pending = programmaticRef.current;
    if (pending && Math.abs(top - pending.expectedTop) <= PROGRAMMATIC_MATCH_TOL_PX) {
      // Our own snap — don't touch pin state or direction, but still probe perf.
      cancelAnimationFrame(pending.frame);
      programmaticRef.current = null;
      onScrollSample({ programmatic: true });
      return;
    }

    // H2 hardening: when a programmatic marker is pending but the tolerance
    // missed (scrollHeight changed between our write and this event, or a
    // second snap overwrote the marker before the first event dispatched),
    // treat the event as programmatic if the scroll moved downward. Unpinning
    // here would be a false positive — the user never scrolled.
    if (pending && pinnedRef.current && top >= pending.expectedTop - PROGRAMMATIC_MATCH_TOL_PX) {
      cancelAnimationFrame(pending.frame);
      programmaticRef.current = null;
      onScrollSample({ programmatic: true });
      return;
    }

    const distance = resolveVirtualBottomDistance({
      scrollOffset: top,
      viewportSize: viewport.clientHeight,
      totalVirtualSize: viewport.scrollHeight,
    });
    const delta = top - previousTop;
    if (distance > repinThresholdPx) {
      consumedAutoFollowBottomInsetRef.current = 0;
      setPinned(false);
    } else if (delta > -DIRECTION_EPSILON_PX) {
      // Within the bottom band and not moving up — the user returned to bottom.
      if (distance <= PROGRAMMATIC_MATCH_TOL_PX) {
        consumedAutoFollowBottomInsetRef.current = autoFollowBottomInsetRef.current;
      }
      setPinned(true);
    } else {
      // Within the band but still moving up — the user is leaving.
      consumedAutoFollowBottomInsetRef.current = 0;
      setPinned(false);
    }
    onScrollSample({ programmatic: false });
  }, [onScrollSample, pinnedRef, repinThresholdPx, setPinned]);

  const startGlueLoop = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (glueFrameRef.current != null) {
      cancelAnimationFrame(glueFrameRef.current);
    }
    let lastHeight = -1;
    let stableFrames = 0;
    let totalFrames = 0;
    const tick = () => {
      const viewport = scrollRef.current;
      // Bail the moment the user reclaims control (an intent listener unpins).
      if (!viewport || !pinnedRef.current) {
        glueFrameRef.current = null;
        return;
      }
      notifyProgrammaticScroll(() => {
        viewport.scrollTop = resolveAutoFollowScrollTop(
          viewport,
          autoFollowBottomInsetRef.current,
          consumedAutoFollowBottomInsetRef.current,
        );
      });
      const height = viewport.scrollHeight;
      if (height === lastHeight) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        lastHeight = height;
      }
      totalFrames += 1;
      if (stableFrames >= GLUE_STABLE_FRAMES || totalFrames >= GLUE_MAX_FRAMES) {
        glueFrameRef.current = null;
        return;
      }
      glueFrameRef.current = requestAnimationFrame(tick);
    };
    glueFrameRef.current = requestAnimationFrame(tick);
  }, [notifyProgrammaticScroll, scrollRef]);

  // Session re-entry: snap instantly, then glue for a few frames so the
  // measurement backlog of freshly mounted rows (virtualizer estimates
  // correcting to real heights) lands as one silent jump instead of a visible
  // scroll from an old position to the bottom.
  const resetForSession = useCallback(() => {
    if (programmaticRef.current?.frame != null) {
      cancelAnimationFrame(programmaticRef.current.frame);
    }
    programmaticRef.current = null;
    lastScrollTopRef.current = 0;
    consumedAutoFollowBottomInsetRef.current = 0;
    setPinned(true);
    scrollToBottom();
    startGlueLoop();
  }, [scrollToBottom, setPinned, startGlueLoop]);

  // Pre-emptive intent-to-leave: flip the pin ref synchronously when the user
  // acts, BEFORE the next per-frame snap effect reads it, so the snap bails and
  // the user actually escapes. The scroll-event classifier alone loses this race
  // because a snap can overwrite scrollTop before the scroll event is read.
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }
    let touchStartY = 0;
    // All three listeners gate on `viewportCanScroll`: an intent to leave the
    // bottom is meaningless when there is nowhere to scroll, and acting on it
    // would strand the engine unpinned (no scroll event follows to re-pin).
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && viewportCanScroll(viewport)) {
        setPinned(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") &&
        viewportCanScroll(viewport)
      ) {
        setPinned(false);
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchStartY;
      // Finger dragging down reveals content above (scrolls toward history).
      if (y - touchStartY > DIRECTION_EPSILON_PX && viewportCanScroll(viewport)) {
        setPinned(false);
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
    };
  }, [scrollRef, setPinned]);

  // On tab/window re-show while pinned, glue to the bottom for a few frames so
  // the suspended-then-resumed measurement backlog lands as one jump. Listen to
  // both visibilitychange and focus (WKWebView may fire only the latter).
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !pinnedRef.current) {
        return;
      }
      startGlueLoop();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (glueFrameRef.current != null) {
        cancelAnimationFrame(glueFrameRef.current);
        glueFrameRef.current = null;
      }
    };
  }, [startGlueLoop]);

  useEffect(() => () => {
    if (programmaticRef.current?.frame != null) {
      cancelAnimationFrame(programmaticRef.current.frame);
    }
    if (glueFrameRef.current != null) {
      cancelAnimationFrame(glueFrameRef.current);
    }
  }, []);

  return {
    isPinnedToBottom,
    pinnedRef,
    onViewportScroll,
    scrollToBottom,
    handleScrollToBottomClick,
    notifyProgrammaticScroll,
    setPinned,
    resetForSession,
  };
}

function resolveAutoFollowScrollTop(
  viewport: HTMLDivElement,
  bottomInsetPx: number,
  consumedBottomInsetPx: number,
): number {
  const remainingManualInsetPx = Math.max(0, bottomInsetPx - consumedBottomInsetPx);
  if (remainingManualInsetPx <= 0) {
    // Preserve the established write-to-scrollHeight behavior: browsers clamp
    // this to their exact maximum scrollTop without subpixel bookkeeping.
    return viewport.scrollHeight;
  }
  const hardBottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  return Math.max(0, hardBottom - remainingManualInsetPx);
}
