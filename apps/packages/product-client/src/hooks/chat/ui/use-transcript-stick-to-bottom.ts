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
  const programmaticRef = useRef<{ expectedTop: number; frame: number } | null>(null);
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
    const userInitiated = interactionNow() < userScrollIntentUntilRef.current;
    onScrollSample(
      userInitiated
        ? { programmatic: false, userInitiated: true }
        : { programmatic: false },
    );
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
    if (programmaticRef.current?.frame != null) {
      cancelAnimationFrame(programmaticRef.current.frame);
    }
    programmaticRef.current = null;
    lastScrollTopRef.current = 0;
    consumedAutoFollowBottomInsetRef.current = 0;
    userScrollIntentUntilRef.current = 0;
    setPinned(true);
    scrollToBottom();
    startGlueLoop();
  }, [scrollToBottom, setPinned, startGlueLoop]);

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
