import { useCallback, useRef, useState } from "react";
import { resolveVirtualBottomDistance } from "#product/domain/chats/transcript/transcript-virtual-rows";
import {
  DIRECTION_EPSILON_PX,
  REPIN_BOTTOM_THRESHOLD_PX,
  TRANSCRIPT_USER_SCROLL_SETTLE_MS,
  type ContentHeightScrollAnchor,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import { decideTranscriptScrollPin } from "#product/hooks/chat/ui/transcript-scroll-pin-decision";
import { TranscriptFramePipeline } from "#product/hooks/chat/ui/transcript-frame-pipeline";
import { useTranscriptFramePipelineLifecycle } from "#product/hooks/chat/ui/use-transcript-frame-pipeline-lifecycle";
import { TranscriptScrollOwnershipMarkers } from "#product/hooks/chat/ui/transcript-scroll-ownership";
import { useTranscriptAutoFollowBottom } from "#product/hooks/chat/ui/use-transcript-auto-follow-bottom";
import { useTranscriptSubmitStampRepin } from "#product/hooks/chat/ui/use-transcript-submit-stamp-repin";
import { useTranscriptNewContentSignal } from "#product/hooks/chat/ui/use-transcript-new-content-signal";
import { useTranscriptUserScrollIntent } from "#product/hooks/chat/ui/use-transcript-user-scroll-intent";
import { beginSessionRestorePlacement, type TranscriptSessionRestorePlan } from "#product/hooks/chat/ui/transcript-reading-position-store";
import type {
  TranscriptStickToBottom,
  UseTranscriptStickToBottomOptions,
} from "#product/hooks/chat/ui/use-transcript-stick-to-bottom-types";

export type { TranscriptStickToBottom, UseTranscriptStickToBottomOptions };

function interactionNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

// FR-2 (rung 6): how long the single frame pass re-resolves the saved reading
// anchor after a finalized-session revisit so residual corrections land.
const RESTORE_MAX_MS = 500;

// How long after a prepend the frame pass keeps absorbing freshly-mounted rows'
// estimate-to-measured corrections into scrollTop (reading row stays fixed).
// Corrections arrive over several frames via the ResizeObserver, so compensation
// is bounded by this deadline (not the glue window's quiet-frame termination);
// after it, below-viewport growth is free to move the reader again.
const ABOVE_CHANGE_COMPENSATION_MAX_MS = 500;

/**
 * Single stick-to-bottom engine shared by the full and virtualized transcript
 * lists. Distinguishes user scrolls from its own programmatic snaps, re-pins only
 * within a tight bottom band, and collapses a resume measurement backlog into one
 * jump instead of a visible crawl.
 */
export function useTranscriptStickToBottom({
  scrollRef,
  onScrollSample,
  repinThresholdPx = REPIN_BOTTOM_THRESHOLD_PX,
  structuralBottomInsetPx = 0,
  nonDisplacingBottomInsetPx = 0,
  lastPromptSubmittedAtMs = null,
  sessionKey,
}: UseTranscriptStickToBottomOptions): TranscriptStickToBottom {
  const pinnedRef = useRef(true);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  // Q18 (rung 9): see use-transcript-new-content-signal.ts.
  const {
    hasNewContentWhileUnpinned,
    clearNewContentSignal,
    notifyContentGrew,
    reset: resetNewContentSignal,
  } = useTranscriptNewContentSignal();
  const lastScrollTopRef = useRef(0);
  // Last observed content height: lets a scroll event tell a genuine user
  // displacement (same-size content) apart from our snap lagging a growing stream
  // (content just grew). Only the former unpins. See onViewportScroll.
  const lastContentHeightRef = useRef(0);
  // Ownership markers: the PRIMARY signal telling our own writes apart from a
  // user scroll. See transcript-scroll-ownership.ts.
  const ownershipMarkersRef = useRef(new TranscriptScrollOwnershipMarkers());
  // One per-frame mutate-then-snap pipeline (rung 4 / PRO-187): replaces the
  // session-entry / submit / tab-resume / above-change rAF loops with one owned
  // scheduler and ONE snap writer.
  const pipelineRef = useRef(new TranscriptFramePipeline());
  // Active above-change compensation anchor, applied by the single frame writer
  // while unpinned until its deadline lapses (the deadline, not the glue window,
  // bounds it so a post-glue correction is still absorbed).
  const compensationAnchorRef = useRef<ContentHeightScrollAnchor | null>(null);
  // Whether the active compensation cancels on upward user intent: true for a
  // completed-turn split (autonomous); false for a history prepend (reader-asked).
  const compensationCancelableRef = useRef(false);
  // Deadline (interactionNow ms) past which the active above-change anchor is
  // stale: the frame pass compensates each correction before it, then stops so
  // below-viewport growth can move the reader. Bounds compensation by wall-clock
  // instead of the glue window's quiet-frame termination (which ends a frame
  // early on a slow runner and loses the last correction).
  const compensationDeadlineRef = useRef(0);
  // FR-2 restore (rung 6): frame writer re-resolves this each glued frame so the saved reading row holds as heights settle.
  const restoreResolverRef = useRef<((viewport: HTMLElement) => number | null) | null>(null);
  const restoreDeadlineRef = useRef(0);
  const userScrollIntentUntilRef = useRef(0);

  const setPinned = useCallback((next: boolean) => {
    if (next) {
      // Re-pinning (any path: repin band, submit, button click) means the
      // reader is at the bottom seeing the new content, so the announcement
      // is done regardless of whether pin state itself changed.
      clearNewContentSignal();
    }
    if (pinnedRef.current === next) {
      return;
    }
    pinnedRef.current = next;
    setIsPinnedToBottom(next);
  }, [clearNewContentSignal]);

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
    // The reader is driving: end any in-flight FR-2 restore (rung 6).
    restoreResolverRef.current = null;
    if (direction < 0) {
      // Upward intent cancels only a CANCELABLE above-change compensation (a
      // completed-turn split): the gesture wins, no per-frame re-anchor. A history
      // PREPEND is NON-cancelable (reader asked for it by scrolling up) so it holds.
      // See use-transcript-stick-to-bottom.compensation.test.tsx.
      if (compensationCancelableRef.current) {
        compensationAnchorRef.current = null;
      }
      setPinned(false);
    }
    // Claim the frame at input time so it can't race a stream/reveal animation frame.
    onScrollSample({ programmatic: false, userInitiated: true });
  }, [onScrollSample, setPinned]);

  // Owns the consumed-inset machine, follow-target math, and scroll-to-bottom
  // callbacks. See use-transcript-auto-follow-bottom.ts.
  const {
    dispatchInsetEvent,
    scrollToBottom,
    handleScrollToBottomClick,
  } = useTranscriptAutoFollowBottom({
    scrollRef,
    structuralBottomInsetPx,
    nonDisplacingBottomInsetPx,
    pinnedRef,
    setPinned,
    lastScrollTopRef,
    markNonUserScrollPosition,
    notifyProgrammaticScroll,
  });

  // Q6 (rung 7): submit re-pins but does NOT consume the overlay (explicit no-op).
  const submitRepin = useCallback(() => {
    dispatchInsetEvent({ type: "submit_repin" });
  }, [dispatchInsetEvent]);

  const onViewportScroll = useCallback((viewport: HTMLDivElement) => {
    const top = viewport.scrollTop;
    const previousTop = lastScrollTopRef.current;
    lastScrollTopRef.current = top;

    // Classification ladder. PRIMARY: a live ownership marker (queued, so a burst
    // of glue writes keeps attribution) owns this event — clear and return.
    if (ownershipMarkersRef.current.matchByValue(top)) {
      onScrollSample({ programmatic: true });
      return;
    }

    // No live marker: user scroll (intent-attributed below) or unattributed; the
    // user-scroll-wins pin logic runs unchanged either way.
    const distance = resolveVirtualBottomDistance({
      scrollOffset: top,
      viewportSize: viewport.clientHeight,
      totalVirtualSize: viewport.scrollHeight,
    });
    const delta = top - previousTop;

    // Content-size change observed here is the durable signal that our own follow
    // (not the user) opened the bottom-distance. Classification lives in
    // decideTranscriptScrollPin; this hook only reads geometry and applies it.
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
      // FR-2, rung 6: do NOT clear the restore resolver here. An unmatched scroll
      // mid-restore is our OWN placement write clamped to the not-yet-measured
      // content max, not the reader; clearing it would kill the frame writer's
      // re-resolution. A real takeover clears via notifyUserScrollIntent.
      dispatchInsetEvent({ type: "leave_band" });
      setPinned(false);
    } else if (decision.pin === true) {
      if (decision.consumeInset === "full") {
        dispatchInsetEvent({ type: "consume_full" });
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
  }, [dispatchInsetEvent, onScrollSample, pinnedRef, repinThresholdPx, setPinned]);

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
    // Q18 (rung 9): the single content ResizeObserver (rung 4) feeds the
    // new-content signal too, so it is derived from the model's own measured
    // geometry rather than a separate scroll listener or DOM poll.
    const viewport = scrollRef.current;
    if (viewport) {
      notifyContentGrew(viewport.scrollHeight, pinnedRef.current);
    }
    pipelineRef.current.requestFrame();
  }, [notifyContentGrew, scrollRef]);

  const cancelFramePipeline = useCallback(() => {
    pipelineRef.current.cancel();
  }, []);

  // Hold anchored content in place while a row inserted ABOVE it measures in.
  // Sets the compensation anchor and starts a glue window; the single frame
  // writer re-applies the measured scrollHeight delta each glued frame (so the
  // anchor stays put as the estimate corrects) until the height settles.
  const startAboveChangeCompensation = useCallback((
    anchor: ContentHeightScrollAnchor,
    cancelableByUpwardIntent: boolean,
  ) => {
    compensationAnchorRef.current = anchor;
    compensationCancelableRef.current = cancelableByUpwardIntent;
    compensationDeadlineRef.current = interactionNow() + ABOVE_CHANGE_COMPENSATION_MAX_MS;
    beginGlue();
  }, [beginGlue]);

  // A prompt submit is an explicit return-to-bottom intent (PRO-175 scopes it to
  // session identity) — see use-transcript-submit-stamp-repin.ts. Registered
  // before consumer layout effects so their pinned snaps read the restored pin.
  useTranscriptSubmitStampRepin({
    lastPromptSubmittedAtMs,
    sessionKey,
    setPinned,
    scrollToBottom,
    beginGlue,
    onSubmitRepin: submitRepin,
  });

  // Session re-entry: snap instantly, then glue for a few frames so the mounted
  // rows' measurement backlog (estimates correcting to real heights) lands as
  // one silent jump instead of a visible scroll from the old position.
  const resetForSession = useCallback((plan?: TranscriptSessionRestorePlan) => {
    clearAllMarkers();
    compensationAnchorRef.current = null;
    compensationCancelableRef.current = false;
    compensationDeadlineRef.current = 0;
    restoreResolverRef.current = null;
    restoreDeadlineRef.current = 0;
    lastScrollTopRef.current = 0;
    lastContentHeightRef.current = 0;
    resetNewContentSignal();
    dispatchInsetEvent({ type: "reset" });
    userScrollIntentUntilRef.current = 0;
    // FR-2 (rung 6): restore a finalized session's saved reading position before
    // first paint; a streaming session / missing plan / vanished row bottom-pins
    // (conservative default). The frame writer re-resolves the anchor each glued
    // frame so residual corrections land silently.
    const restored = beginSessionRestorePlacement(
      plan ?? { kind: "bottom" },
      interactionNow() + RESTORE_MAX_MS,
      { scrollRef, restoreResolverRef, restoreDeadlineRef },
      setPinned,
      notifyProgrammaticScroll,
    );
    if (!restored) {
      setPinned(true);
      scrollToBottom();
    }
    beginGlue();
  }, [beginGlue, clearAllMarkers, dispatchInsetEvent, notifyProgrammaticScroll, resetNewContentSignal, scrollRef, scrollToBottom, setPinned]);

  // Establish input ownership before the visibility lifecycle can resume the
  // pinned glue loop.
  useTranscriptUserScrollIntent({ scrollRef, notifyUserScrollIntent });

  // The frame pipeline's single writer, its tab/window-resume glue, and its
  // disposal. Registered after beginGlue so the resume path can trigger it.
  useTranscriptFramePipelineLifecycle({
    pipelineRef,
    scrollRef,
    pinnedRef,
    compensationAnchorRef,
    compensationDeadlineRef,
    restoreResolverRef,
    restoreDeadlineRef,
    scrollToBottom,
    notifyProgrammaticScroll,
    clearAllMarkers,
    beginGlue,
  });

  return {
    isPinnedToBottom,
    hasNewContentWhileUnpinned,
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
