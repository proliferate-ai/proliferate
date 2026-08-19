import { useCallback, useRef, useState } from "react";
import { resolveVirtualBottomDistance } from "#product/domain/chats/transcript/transcript-virtual-rows";
import { readTranscriptEasedFollowEnabled } from "#product/hooks/chat/ui/transcript-eased-follow";
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
import {
  beginSessionRestorePlacement,
  type TranscriptRestoreResolution,
  type TranscriptSessionRestorePlan,
} from "#product/hooks/chat/ui/transcript-reading-position-store";
import type {
  TranscriptStickToBottom,
  UseTranscriptStickToBottomOptions,
} from "#product/hooks/chat/ui/use-transcript-stick-to-bottom-types";
import {
  recordTranscriptPinTransition,
  recordTranscriptUserScrollIntent,
  type TranscriptPinTransitionCause,
} from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations-transcript";

export type { TranscriptStickToBottom, UseTranscriptStickToBottomOptions };

function interactionNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

// FR-2 (rung 6): how long the frame pass re-resolves the saved reading anchor after a finalized-session revisit.
const RESTORE_MAX_MS = 500;

// How long the frame pass keeps absorbing a prepend's estimate-to-measured corrections, bounded by wall-clock.
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
  // PRO-168 (rung 12, Q16): read once; flipping the flag mid-session is not a
  // supported live-toggle, matching the virtualization-mode flag's contract.
  const [easedFollowEnabled] = useState(readTranscriptEasedFollowEnabled);
  // Q18 (rung 9): see use-transcript-new-content-signal.ts.
  const {
    hasNewContentWhileUnpinned,
    clearNewContentSignal,
    notifyContentGrew,
    reset: resetNewContentSignal,
  } = useTranscriptNewContentSignal();
  const lastScrollTopRef = useRef(0);
  // Distinguishes user displacement from follow lag during content growth.
  const lastContentHeightRef = useRef(0);
  // Primary signal separating owned writes from user scrolls.
  const ownershipMarkersRef = useRef(new TranscriptScrollOwnershipMarkers());
  // One scheduler and writer replace the former independent frame loops.
  const pipelineRef = useRef(new TranscriptFramePipeline());
  const compensationAnchorRef = useRef<ContentHeightScrollAnchor | null>(null);
  const compensationCancelableRef = useRef(false);
  const compensationDeadlineRef = useRef(0);
  const compensationAbsoluteDeadlineRef = useRef<{
    anchor: ContentHeightScrollAnchor | null;
    deadline: number;
  }>({ anchor: null, deadline: 0 });
  // FR-2 restore re-resolves the saved row while mounted heights settle.
  const restoreResolverRef = useRef<((viewport: HTMLElement) => TranscriptRestoreResolution | null) | null>(null);
  const restoreDeadlineRef = useRef(0);
  const userScrollIntentUntilRef = useRef(0);
  // Monotonic count of scroll events NOT attributable to one of our own writes,
  // i.e. observed native scroll activity. The frame writer reads and resets it
  // each pass to tell "the seat is held" apart from "the seat is held so far,
  // with a native scroll lifecycle still running" — see
  // use-transcript-frame-pipeline-lifecycle.ts.
  const nativeScrollActivityRef = useRef(0);

  // `cause` labels diagnostics only; it never changes pin behavior.
  const setPinned = useCallback((next: boolean, cause: TranscriptPinTransitionCause = "unspecified") => {
    if (next) {
      compensationAnchorRef.current = null;
      compensationAbsoluteDeadlineRef.current = { anchor: null, deadline: 0 };
      // Any repin consumes the new-content announcement.
      clearNewContentSignal();
    }
    if (pinnedRef.current === next) {
      return;
    }
    pinnedRef.current = next;
    setIsPinnedToBottom(next);
    recordTranscriptPinTransition({ sessionId: sessionKey ?? "unknown", pinned: next, cause });
  }, [clearNewContentSignal, sessionKey]);

  const clearAllMarkers = useCallback(() => {
    ownershipMarkersRef.current.clear();
  }, []);

  const markNonUserScrollPosition = useCallback((viewport: HTMLDivElement) => {
    const expectedTop = viewport.scrollTop;
    // Preserve markers for other programmatic writes still awaiting events.
    ownershipMarkersRef.current.record(expectedTop);
    lastScrollTopRef.current = expectedTop;
    // Baseline resize detection to the height this owned write used.
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

  const resolveNonCancelableCompensationProtection = useCallback((clearExpired: boolean) => {
    const anchor = compensationAnchorRef.current;
    if (anchor == null || compensationCancelableRef.current) {
      return false;
    }
    const absolute = compensationAbsoluteDeadlineRef.current;
    const now = interactionNow();
    const isProtected = now < compensationDeadlineRef.current
      || (absolute.anchor === anchor && now < absolute.deadline);
    if (!isProtected && clearExpired) {
      compensationAnchorRef.current = null;
      compensationAbsoluteDeadlineRef.current = { anchor: null, deadline: 0 };
    }
    return isProtected;
  }, []);

  const notifyUserScrollIntent = useCallback((direction: -1 | 1) => {
    resolveNonCancelableCompensationProtection(true);
    userScrollIntentUntilRef.current = interactionNow() + TRANSCRIPT_USER_SCROLL_SETTLE_MS;
    // The reader is driving: end any in-flight FR-2 restore (rung 6).
    restoreResolverRef.current = null;
    // Rung 11: records intent so a prod log can tell false-unpin apart from a swallowed user scroll (ADR §5).
    recordTranscriptUserScrollIntent({ sessionId: sessionKey ?? "unknown", direction });
    if (direction < 0) {
      // Upward intent cancels only a CANCELABLE compensation (completed-turn
      // split); a history PREPEND is NON-cancelable and holds regardless. See
      // use-transcript-stick-to-bottom.compensation.test.tsx.
      if (compensationCancelableRef.current) {
        compensationAnchorRef.current = null;
        compensationAbsoluteDeadlineRef.current = { anchor: null, deadline: 0 };
      }
      setPinned(false, "user_intent_unpin");
    }
    // Claim the frame at input time so it can't race a stream/reveal animation frame.
    onScrollSample({ programmatic: false, userInitiated: true });
  }, [onScrollSample, resolveNonCancelableCompensationProtection, sessionKey, setPinned]);

  // Owns the consumed-inset machine, follow-target math, and scroll-to-bottom
  // callbacks. See use-transcript-auto-follow-bottom.ts.
  const {
    dispatchInsetEvent,
    scrollToBottom,
    handleScrollToBottomClick,
    resolveFollowTargetTop,
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

    // Re-arm a bounded prepend owner before marker precedence.
    const hasLiveNonCancelableCompensation = resolveNonCancelableCompensationProtection(false);
    if (hasLiveNonCancelableCompensation) {
      pipelineRef.current.ensureGlue();
    }

    // Classification ladder. PRIMARY: a live ownership marker (queued, so a burst
    // of glue writes keeps attribution) owns this event — clear and return.
    if (ownershipMarkersRef.current.matchByValue(top)) {
      onScrollSample({ programmatic: true });
      return;
    }
    // Past marker precedence this event is native scroll activity: a wheel or
    // its momentum continuation, a touch fling, or a compositor-side position
    // change. Record it so the frame writer knows a native scroll lifecycle was
    // still running as of this frame and a seated read is not yet proof.
    nativeScrollActivityRef.current += 1;
    resolveNonCancelableCompensationProtection(true);

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
      setPinned(false, "leave_band");
    } else if (decision.pin === true) {
      if (decision.consumeInset === "full") {
        dispatchInsetEvent({ type: "consume_full" });
      }
      setPinned(true, "repin_band");
    }
    // decision.pin === "hold": our own resize lag — leave pin and inset as they
    // are so a lagging follow is never misread as the user leaving.
    const userInitiated = interactionNow() < userScrollIntentUntilRef.current;
    onScrollSample(
      userInitiated
        ? { programmatic: false, userInitiated: true }
        : { programmatic: false },
    );
  }, [
    dispatchInsetEvent,
    onScrollSample,
    pinnedRef,
    repinThresholdPx,
    resolveNonCancelableCompensationProtection,
    setPinned,
  ]);

  // Glue snaps while a mounted/resumed measurement backlog settles.
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
    if (resolveNonCancelableCompensationProtection(true)) {
      return;
    }
    pipelineRef.current.cancel();
  }, [resolveNonCancelableCompensationProtection]);

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
    compensationAbsoluteDeadlineRef.current = { anchor: null, deadline: 0 };
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
    compensationAbsoluteDeadlineRef.current = { anchor: null, deadline: 0 };
    restoreResolverRef.current = null;
    restoreDeadlineRef.current = 0;
    lastScrollTopRef.current = 0;
    lastContentHeightRef.current = 0;
    resetNewContentSignal();
    dispatchInsetEvent({ type: "reset" });
    userScrollIntentUntilRef.current = 0;
    nativeScrollActivityRef.current = 0;
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
      setPinned(true, "session_reset");
      scrollToBottom();
    }
    beginGlue();
  }, [beginGlue, clearAllMarkers, dispatchInsetEvent, notifyProgrammaticScroll, resetNewContentSignal, scrollRef, scrollToBottom, setPinned]);

  // Establish input ownership before the visibility lifecycle can resume the
  // pinned glue loop.
  useTranscriptUserScrollIntent({ scrollRef, notifyUserScrollIntent });

  // Founder Ruling 3 (rung 10, PRO-187): a restore whose deadline lapses having
  // never mounted the saved row gives up on the coarse estimate and bottom-pins
  // instead — the conservative FR-2 default, same as a vanished saved row.
  const notifyRestoreStranded = useCallback(() => {
    setPinned(true, "restore_stranded");
    scrollToBottom();
  }, [scrollToBottom, setPinned]);

  // The frame pipeline's single writer, its tab/window-resume glue, and its
  // disposal. Registered after beginGlue so the resume path can trigger it.
  useTranscriptFramePipelineLifecycle({
    pipelineRef,
    scrollRef,
    pinnedRef,
    compensationAnchorRef,
    compensationDeadlineRef,
    compensationAbsoluteDeadlineRef,
    nativeScrollActivityRef,
    restoreResolverRef,
    restoreDeadlineRef,
    scrollToBottom,
    easedFollowEnabled,
    resolveFollowTargetTop,
    notifyProgrammaticScroll,
    clearAllMarkers,
    beginGlue,
    onRestoreStranded: notifyRestoreStranded,
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
    // Ruling 3(c): the blank-fallback grace window subordinates to this real
    // reserved-slot/compensation signal instead of an independent timer.
    compensationDeadlineRef,
  };
}
