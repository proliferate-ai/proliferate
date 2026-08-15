import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { resolveVirtualBottomDistance } from "#product/domain/chats/transcript/transcript-virtual-rows";
import {
  DIRECTION_EPSILON_PX,
  PROGRAMMATIC_MATCH_TOL_PX,
  REPIN_BOTTOM_THRESHOLD_PX,
  TRANSCRIPT_USER_SCROLL_SETTLE_MS,
  type ContentHeightScrollAnchor,
  type TranscriptScrollSample,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import { decideTranscriptScrollPin } from "#product/hooks/chat/ui/transcript-scroll-pin-decision";
import { resolveAutoFollowScrollTop } from "#product/hooks/chat/ui/transcript-auto-follow-target";
import { TranscriptFramePipeline } from "#product/hooks/chat/ui/transcript-frame-pipeline";
import { TranscriptScrollOwnershipMarkers } from "#product/hooks/chat/ui/transcript-scroll-ownership";
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
  /**
   * Mutation source for the single content ResizeObserver: request the one
   * per-frame snap pass. Coalesces with every other source into ONE snap.
   */
  notifyContentResize: () => void;
  /**
   * Hold anchored content in place while a freshly-inserted row above it
   * measures in, routed through the single frame pipeline instead of an
   * independent rAF delta loop. Applies the measured scrollHeight delta each
   * glued frame while unpinned; a no-op while pinned.
   */
  startAboveChangeCompensation: (anchor: ContentHeightScrollAnchor) => void;
  /**
   * Cancel the pending frame pass / glue window. Registered as the transcript's
   * synchronous scroll-pause listener so a user scroll inside the input event's
   * call stack pre-empts any queued programmatic snap.
   */
  cancelFramePipeline: () => void;
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
  // Last observed content height, tracked so a scroll event can tell a genuine
  // user displacement (bottom-distance opened up while the content stayed the
  // same size) apart from our own snap lagging a growing stream (bottom-distance
  // opened up BECAUSE the content just grew). Only the former unpins a pinned
  // viewport. See the pin decision in onViewportScroll.
  const lastContentHeightRef = useRef(0);
  // Ownership markers: the PRIMARY classification signal telling our own
  // writes apart from a user scroll. See transcript-scroll-ownership.ts.
  // `useRef`'s initializer only takes effect on the first render.
  const ownershipMarkersRef = useRef(new TranscriptScrollOwnershipMarkers());
  // One per-frame mutate-then-snap pipeline (rung 4 / PRO-187): replaces the
  // session-entry / submit / tab-resume glue rAF loops and the above-change
  // compensation rAF loop with a single owned scheduler and ONE snap writer.
  const pipelineRef = useRef(new TranscriptFramePipeline());
  // Active above-change compensation anchor, applied by the single frame writer
  // while unpinned and gluing (was the standalone compensation rAF loop).
  const compensationAnchorRef = useRef<ContentHeightScrollAnchor | null>(null);
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

  const clearAllMarkers = useCallback(() => {
    ownershipMarkersRef.current.clear();
  }, []);

  const markNonUserScrollPosition = useCallback((viewport: HTMLDivElement) => {
    const expectedTop = viewport.scrollTop;
    // Record ownership without disturbing markers already in flight: several
    // programmatic writes can await their events at once (see
    // transcript-scroll-ownership.ts).
    ownershipMarkersRef.current.record(expectedTop);
    lastScrollTopRef.current = expectedTop;
    // Baseline the content-size detector to the height we just snapped against,
    // so a later scroll event only counts as a resize when the content actually
    // changed size past this write (not merely because this write settled).
    lastContentHeightRef.current = viewport.scrollHeight;
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
    userScrollIntentUntilRef.current = interactionNow() + TRANSCRIPT_USER_SCROLL_SETTLE_MS;
    if (direction < 0) {
      // Genuine upward intent cancels an active above-viewport compensation:
      // the reader scrolling up during a completed-turn split or a settling
      // prepend must never be re-anchored per-frame; the gesture wins (CSS
      // scroll anchoring likewise suppresses adjustments during user scroll).
      // Clearing the ANCHOR THAT EXISTS NOW is exactly the ruling's nuance: a
      // window armed LATER (the wheel-up that triggered a prepend, since
      // stopped) has no anchor yet and is untouched. Downward intent and the
      // programmatic snaps routed through notifyProgrammaticScroll never reach
      // here, so neither can cancel.
      compensationAnchorRef.current = null;
      setPinned(false);
    }
    // Claim the frame at input time so it can't race a stream/reveal animation frame.
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
    // longer loses attribution to a single overwritten slot. See
    // transcript-scroll-ownership.ts for the queue implementation.
    if (ownershipMarkersRef.current.matchByValue(top)) {
      onScrollSample({ programmatic: true });
      return;
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

    // Content-size change is observed here (not inferred from a marker) so it is
    // the durable signal that our own follow — not the user — opened the
    // bottom-distance. The classification itself (content-size hold, direction
    // gate, repin band) lives in decideTranscriptScrollPin; this hook only reads
    // the geometry and applies the returned decision to pin + inset state.
    const scrollHeightChanged =
      lastContentHeightRef.current > 0
      && Math.abs(viewport.scrollHeight - lastContentHeightRef.current) > DIRECTION_EPSILON_PX;
    lastContentHeightRef.current = viewport.scrollHeight;
    const decision = decideTranscriptScrollPin({
      distance,
      delta,
      scrollHeightChanged,
      pinned: pinnedRef.current,
      repinThresholdPx,
    });
    if (decision.pin === false) {
      consumedAutoFollowBottomInsetRef.current = 0;
      setPinned(false);
    } else if (decision.pin === true) {
      if (decision.consumeInset === "full") {
        consumedAutoFollowBottomInsetRef.current = autoFollowBottomInsetRef.current;
      }
      setPinned(true);
    }
    // decision.pin === "hold": our own resize lag — leave pin and inset as they
    // are so a lagging follow is never misread as the user leaving.
    const userInitiated = interactionNow() < userScrollIntentUntilRef.current;
    onScrollSample(
      userInitiated
        ? { programmatic: false, userInitiated: true }
        : { programmatic: false },
    );
  }, [onScrollSample, pinnedRef, repinThresholdPx, setPinned]);

  // The SINGLE snap/compensation writer the frame pipeline drives each frame.
  // Snap to the follow target while pinned; apply the above-change compensation
  // delta while unpinned inside a glue window; otherwise do nothing. Every write
  // still flows through the rung-3 ownership markers (WHO wrote); the pipeline
  // owns only WHEN. Registered once via the ref initializer's stable instance.
  const runFramePass = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }
    if (pinnedRef.current) {
      scrollToBottom();
      return;
    }
    const anchor = compensationAnchorRef.current;
    if (anchor && pipelineRef.current.isGluing) {
      notifyProgrammaticScroll(() => {
        viewport.scrollTop = anchor.scrollTop + (viewport.scrollHeight - anchor.scrollHeight);
      });
    }
  }, [notifyProgrammaticScroll, scrollRef, scrollToBottom]);

  useLayoutEffect(() => {
    const pipeline = pipelineRef.current;
    pipeline.setWriter({
      runFramePass,
      measureContentHeight: () => scrollRef.current?.scrollHeight ?? -1,
      shouldContinueGlue: () => {
        const viewport = scrollRef.current;
        if (!viewport) {
          return false;
        }
        // A pinned burst glues to the bottom; an unpinned burst glues an active
        // above-change compensation anchor. Either way the user reclaiming
        // control (unpin with no anchor) ends the window.
        return pinnedRef.current || compensationAnchorRef.current != null;
      },
    });
  }, [runFramePass, scrollRef]);

  // Session re-entry / submit / tab-resume "glue": snap each frame while a
  // freshly mounted or resumed measurement backlog lands, terminating when the
  // content ResizeObserver goes quiet or the hard cap elapses.
  const beginGlue = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    pipelineRef.current.beginGlue();
  }, []);

  const notifyContentResize = useCallback(() => {
    pipelineRef.current.requestFrame();
  }, []);

  const cancelFramePipeline = useCallback(() => {
    pipelineRef.current.cancel();
  }, []);

  // Hold anchored content in place while a row inserted ABOVE it measures in.
  // Sets the compensation anchor and starts a glue window; the single frame
  // writer re-applies the measured scrollHeight delta each glued frame (so the
  // anchor stays put as the estimate corrects) until the height settles.
  const startAboveChangeCompensation = useCallback((anchor: ContentHeightScrollAnchor) => {
    compensationAnchorRef.current = anchor;
    beginGlue();
  }, [beginGlue]);

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
    beginGlue,
  });

  // Session re-entry: snap instantly, then glue for a few frames so the
  // measurement backlog of freshly mounted rows (virtualizer estimates
  // correcting to real heights) lands as one silent jump instead of a visible
  // scroll from an old position to the bottom.
  const resetForSession = useCallback(() => {
    clearAllMarkers();
    compensationAnchorRef.current = null;
    lastScrollTopRef.current = 0;
    lastContentHeightRef.current = 0;
    consumedAutoFollowBottomInsetRef.current = 0;
    userScrollIntentUntilRef.current = 0;
    setPinned(true);
    scrollToBottom();
    beginGlue();
  }, [beginGlue, clearAllMarkers, scrollToBottom, setPinned]);

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
      beginGlue();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      pipelineRef.current.cancel();
    };
  }, [beginGlue]);

  useEffect(() => {
    const pipeline = pipelineRef.current;
    return () => {
      clearAllMarkers();
      pipeline.dispose();
    };
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
    notifyContentResize,
    startAboveChangeCompensation,
    cancelFramePipeline,
  };
}
