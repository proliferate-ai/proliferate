import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { resolveVirtualBottomDistance } from "#product/domain/chats/transcript/transcript-virtual-rows";
import {
  DIRECTION_EPSILON_PX,
  GLUE_MAX_FRAMES,
  GLUE_STABLE_FRAMES,
  PROGRAMMATIC_MATCH_TOL_PX,
  REPIN_BOTTOM_THRESHOLD_PX,
  TRANSCRIPT_USER_SCROLL_SETTLE_MS,
  type TranscriptScrollSample,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import { useTranscriptSubmitStampRepin } from "#product/hooks/chat/ui/use-transcript-submit-stamp-repin";
import { useTranscriptUserScrollIntent } from "#product/hooks/chat/ui/use-transcript-user-scroll-intent";

function interactionNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/**
 * A record of one programmatic write, awaiting the scroll event it produces.
 * `expectedTop` is the scrollTop the browser actually settled on after the
 * write (post-clamp), so the resulting event matches within a subpixel
 * tolerance. `frame` is the watchdog rAF that expires the marker if its event
 * never arrives (a clamped or no-op write), so a stale marker cannot leak into
 * the next user scroll. `id` is a monotonic sequence for identity.
 */
interface ProgrammaticMarker {
  id: number;
  expectedTop: number;
  frame: number;
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
  /**
   * Epoch ms of the newest prompt submission (outbox enqueue or session-level
   * optimistic prompt). A monotonic increase re-pins: sending is an explicit
   * return-to-bottom intent. Entries leaving the outbox (delivery, dismissal)
   * can only lower the stamp and must not re-pin.
   */
  lastPromptSubmittedAtMs?: number | null;
  /**
   * Identity of the session/workspace currently mounted (e.g.
   * `${workspaceId}:${sessionId}`). The row lists never remount across a
   * session switch, so `lastPromptSubmittedAtMs` alone can't distinguish "a
   * fresh submit in this session" from "the incoming session's own current
   * stamp, carried over from a stale prior comparison." A change here
   * re-baselines the submit-stamp tracking to the incoming session's current
   * value instead of comparing across the switch.
   */
  sessionKey?: string;
}

export interface TranscriptStickToBottom {
  /** True while pinned to the bottom; drives the scroll-to-bottom button. */
  isPinnedToBottom: boolean;
  /** Live pin state for synchronous reads inside effects/cleanup (no re-render). */
  pinnedRef: RefObject<boolean>;
  /** Wire to AutoHideScrollArea's onViewportScroll. Owns stickiness + direction + onScrollSample. */
  onViewportScroll: (viewport: HTMLDivElement) => void;
  /** Mark positive wheel/key/touch/scrollbar intent before its scroll event arrives. */
  notifyUserScrollIntent: (direction: -1 | 1) => void;
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
  lastPromptSubmittedAtMs = null,
  sessionKey,
}: UseTranscriptStickToBottomOptions): TranscriptStickToBottom {
  const pinnedRef = useRef(true);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const lastScrollTopRef = useRef(0);
  // Ownership markers: the PRIMARY classification signal. Every programmatic
  // write records a marker carrying the scrollTop it produced; the scroll event
  // that matches a live marker is our own write, not the user. A queue (not a
  // single slot) is required because the glue loop writes faster than the
  // browser dispatches scroll events, so several writes can be in flight at
  // once — a single slot would let a later write overwrite an earlier marker
  // before its event arrived, misclassifying that event as a user scroll (the
  // false-unpin the pixel-tolerance fallback used to paper over).
  const pendingMarkersRef = useRef<ProgrammaticMarker[]>([]);
  const markerSeqRef = useRef(0);
  const glueFrameRef = useRef<number | null>(null);
  const autoFollowBottomInsetRef = useRef(Math.max(0, autoFollowBottomInsetPx));
  const consumedAutoFollowBottomInsetRef = useRef(0);
  const userScrollIntentUntilRef = useRef(0);

  const setPinned = useCallback((next: boolean) => {
    if (pinnedRef.current === next) {
      return;
    }
    pinnedRef.current = next;
    setIsPinnedToBottom(next);
  }, []);

  const removeMarker = useCallback((marker: ProgrammaticMarker) => {
    const queue = pendingMarkersRef.current;
    const index = queue.indexOf(marker);
    if (index !== -1) {
      queue.splice(index, 1);
    }
    if (marker.frame !== 0) {
      cancelAnimationFrame(marker.frame);
      marker.frame = 0;
    }
  }, []);

  const clearAllMarkers = useCallback(() => {
    for (const marker of pendingMarkersRef.current) {
      if (marker.frame !== 0) {
        cancelAnimationFrame(marker.frame);
      }
    }
    pendingMarkersRef.current = [];
  }, []);

  const markNonUserScrollPosition = useCallback((viewport: HTMLDivElement) => {
    const expectedTop = viewport.scrollTop;
    // Record ownership without disturbing markers already in flight: several
    // programmatic writes can await their events at once (see the queue note).
    const marker: ProgrammaticMarker = {
      id: (markerSeqRef.current += 1),
      expectedTop,
      frame: 0,
    };
    pendingMarkersRef.current.push(marker);
    // Watchdog: a write that changes nothing (or a browser clamp whose event
    // never arrives) must not leak its marker into the next user scroll. Expire
    // the marker on the next frame if its event has not consumed it by then.
    marker.frame = requestAnimationFrame(() => {
      marker.frame = 0;
      const queue = pendingMarkersRef.current;
      const index = queue.indexOf(marker);
      if (index !== -1) {
        queue.splice(index, 1);
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

  const notifyUserScrollIntent = useCallback((direction: -1 | 1) => {
    userScrollIntentUntilRef.current =
      interactionNow() + TRANSCRIPT_USER_SCROLL_SETTLE_MS;
    if (direction < 0) {
      setPinned(false);
    }
    // Claim the frame at input time instead of waiting for the browser's later
    // scroll event, which can otherwise race a stream/reveal animation frame.
    onScrollSample({ programmatic: false, userInitiated: true });
  }, [onScrollSample, setPinned]);

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
    const requestedTop = resolveAutoFollowScrollTop(
      viewport,
      autoFollowBottomInsetRef.current,
      consumedAutoFollowBottomInsetRef.current,
    );
    const reachableTop = Math.min(
      requestedTop,
      Math.max(0, viewport.scrollHeight - viewport.clientHeight),
    );
    if (Math.abs(viewport.scrollTop - reachableTop) <= PROGRAMMATIC_MATCH_TOL_PX) {
      // Keep direction tracking aligned even when the browser (or the
      // virtualizer's initial offset) already placed us at the target. Without
      // this baseline, the first small upward user scroll can look downward
      // relative to the stale pre-mount position and immediately re-pin.
      lastScrollTopRef.current = viewport.scrollTop;
      return;
    }
    // Pin against the real DOM scroll height, never virtualizer.scrollToIndex:
    // index scrolling positions by the *estimated* size of unmeasured rows
    // (e.g. the row appended by this very update) and visibly bounces when the
    // measurement corrects a frame later.
    notifyProgrammaticScroll(() => {
      viewport.scrollTop = requestedTop;
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

    // Classification ladder. PRIMARY: ownership markers. A live marker recorded
    // by one of our own writes owns this event — clear it and never touch pin
    // state or direction. Because markers are queued, a burst of glue writes no
    // longer loses attribution to a single overwritten slot.
    const queue = pendingMarkersRef.current;
    if (queue.length > 0) {
      const matchIndex = queue.findIndex(
        (marker) => Math.abs(top - marker.expectedTop) <= PROGRAMMATIC_MATCH_TOL_PX,
      );
      if (matchIndex !== -1) {
        removeMarker(queue[matchIndex]);
        onScrollSample({ programmatic: true });
        return;
      }

      // FALLBACK tier (last resort, engaged only while a marker is live): the
      // tolerance missed because scrollHeight changed between our write and this
      // event. The surviving 2px tolerance above and this H2 downward-while-
      // pinned rule are the pre-marker heuristics, retained ONLY for the case a
      // marker exists but its exact landing could not be matched. While pinned,
      // a downward-or-flat move is our own snap catching up, never a user
      // scroll; unpinning here would be a false positive.
      const latest = queue[queue.length - 1];
      if (pinnedRef.current && top >= latest.expectedTop - PROGRAMMATIC_MATCH_TOL_PX) {
        removeMarker(latest);
        onScrollSample({ programmatic: true });
        return;
      }
    }

    // No live marker owns this event: it is a user scroll (intent-attributed
    // below) or an unattributed scroll. Either way the user-scroll-wins pin
    // logic runs unchanged. The `userInitiated` flag distinguishes the two for
    // the perf probe (and, later, rung 11's unattributed-scroll handling).
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
    const userInitiated = interactionNow() < userScrollIntentUntilRef.current;
    onScrollSample(
      userInitiated
        ? { programmatic: false, userInitiated: true }
        : { programmatic: false },
    );
  }, [onScrollSample, pinnedRef, removeMarker, repinThresholdPx, setPinned]);

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
      scrollToBottom();
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
  }, [scrollRef, scrollToBottom]);

  // A prompt submit is an explicit return-to-bottom intent (PRO-175 scopes it
  // to session identity so a session switch can't misfire it) — see
  // use-transcript-submit-stamp-repin.ts. Registered after the inset effect
  // above but before consumer layout effects, so their pinned snaps read the
  // restored pin.
  useTranscriptSubmitStampRepin({
    lastPromptSubmittedAtMs,
    sessionKey,
    setPinned,
    scrollToBottom,
    startGlueLoop,
  });

  // Session re-entry: snap instantly, then glue for a few frames so the
  // measurement backlog of freshly mounted rows (virtualizer estimates
  // correcting to real heights) lands as one silent jump instead of a visible
  // scroll from an old position to the bottom.
  const resetForSession = useCallback(() => {
    clearAllMarkers();
    lastScrollTopRef.current = 0;
    consumedAutoFollowBottomInsetRef.current = 0;
    userScrollIntentUntilRef.current = 0;
    setPinned(true);
    scrollToBottom();
    startGlueLoop();
  }, [clearAllMarkers, scrollToBottom, setPinned, startGlueLoop]);

  // Establish input ownership before the visibility lifecycle can resume the
  // pinned glue loop.
  useTranscriptUserScrollIntent({ scrollRef, notifyUserScrollIntent });

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
    clearAllMarkers();
    if (glueFrameRef.current != null) {
      cancelAnimationFrame(glueFrameRef.current);
    }
  }, [clearAllMarkers]);

  return {
    isPinnedToBottom,
    pinnedRef,
    onViewportScroll,
    notifyUserScrollIntent,
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
