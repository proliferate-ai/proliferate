import { useCallback, useRef, useState, type RefObject } from "react";
import { resolveVirtualBottomDistance } from "#product/domain/chats/transcript/transcript-virtual-rows";
import {
  DIRECTION_EPSILON_PX,
  REPIN_BOTTOM_THRESHOLD_PX,
  TRANSCRIPT_USER_SCROLL_SETTLE_MS,
  type ContentHeightScrollAnchor,
  type TranscriptScrollSample,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import { decideTranscriptScrollPin } from "#product/hooks/chat/ui/transcript-scroll-pin-decision";
import { TranscriptFramePipeline } from "#product/hooks/chat/ui/transcript-frame-pipeline";
import { useTranscriptFramePipelineLifecycle } from "#product/hooks/chat/ui/use-transcript-frame-pipeline-lifecycle";
import { TranscriptScrollOwnershipMarkers } from "#product/hooks/chat/ui/transcript-scroll-ownership";
import { useTranscriptAutoFollowBottom } from "#product/hooks/chat/ui/use-transcript-auto-follow-bottom";
import { useTranscriptSubmitStampRepin } from "#product/hooks/chat/ui/use-transcript-submit-stamp-repin";
import { useTranscriptUserScrollIntent } from "#product/hooks/chat/ui/use-transcript-user-scroll-intent";
import { beginSessionRestorePlacement, type TranscriptSessionRestorePlan } from "#product/hooks/chat/ui/transcript-reading-position-store";

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
  /**
   * Reset tracking for a session switch and place the viewport before first
   * paint: bottom-pin a streaming session, or restore a finalized session to its
   * saved reading anchor (FR-2, rung 6).
   */
  resetForSession: (plan?: TranscriptSessionRestorePlan) => void;
  /**
   * Mutation source for the single content ResizeObserver: request the one
   * per-frame snap pass. Coalesces with every other source into ONE snap.
   */
  notifyContentResize: () => void;
  /**
   * Hold anchored content in place while a freshly-inserted row above it
   * measures in, routed through the single frame pipeline instead of an
   * independent rAF delta loop. Applies the measured scrollHeight delta on every
   * frame pass while unpinned until the compensation deadline lapses; a no-op
   * while pinned.
   */
  startAboveChangeCompensation: (anchor: ContentHeightScrollAnchor, cancelableByUpwardIntent: boolean) => void;
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
  // Last observed content height: lets a scroll event tell a genuine user
  // displacement (same-size content) apart from our snap lagging a growing stream
  // (content just grew). Only the former unpins. See onViewportScroll.
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
  // while unpinned until its deadline lapses (the deadline, not the glue window,
  // bounds it so a post-glue correction is still absorbed).
  const compensationAnchorRef = useRef<ContentHeightScrollAnchor | null>(null);
  // Whether the active compensation window cancels on upward user intent. True
  // for a completed-turn split (autonomous insertion); false for a history
  // prepend (reader-requested, must hold through the continuing upward gesture).
  const compensationCancelableRef = useRef(false);
  // Deadline (interactionNow ms) past which the active above-change anchor is
  // stale: the frame pass compensates each correction before it, then stops so
  // below-viewport growth can move the reader. Bounds compensation by wall-clock
  // instead of the glue window's quiet-frame termination (which ends a frame
  // early on a slow runner and loses the last correction).
  const compensationDeadlineRef = useRef(0);
  // FR-2 restore (rung 6): the single frame writer re-resolves this to a
  // scrollTop each glued frame so the saved reading row holds as heights settle.
  // Null except during a restore; a user scroll clears it.
  const restoreResolverRef = useRef<((viewport: HTMLElement) => number | null) | null>(null);
  const restoreDeadlineRef = useRef(0);
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

  // Owns the manual-only overlay inset, its scrollTop math, and the
  // scroll-to-bottom callbacks. See use-transcript-auto-follow-bottom.ts.
  const {
    consumedAutoFollowBottomInsetRef,
    consumeFullInset,
    scrollToBottom,
    handleScrollToBottomClick,
  } = useTranscriptAutoFollowBottom({
    scrollRef,
    autoFollowBottomInsetPx,
    pinnedRef,
    setPinned,
    lastScrollTopRef,
    markNonUserScrollPosition,
    notifyProgrammaticScroll,
  });

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
      // during an in-flight restore is our OWN placement write clamped by the
      // browser to the not-yet-measured content max, not the reader; clearing it
      // would kill the frame writer's re-resolution before it converges. A real
      // reader takeover clears via notifyUserScrollIntent (restore also expires).
      consumedAutoFollowBottomInsetRef.current = 0;
      setPinned(false);
    } else if (decision.pin === true) {
      if (decision.consumeInset === "full") {
        consumeFullInset();
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
  }, [consumeFullInset, onScrollSample, pinnedRef, repinThresholdPx, setPinned]);

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
  });

  // Session re-entry: snap instantly, then glue for a few frames so the
  // measurement backlog of freshly mounted rows (virtualizer estimates
  // correcting to real heights) lands as one silent jump instead of a visible
  // scroll from an old position to the bottom.
  const resetForSession = useCallback((plan?: TranscriptSessionRestorePlan) => {
    clearAllMarkers();
    compensationAnchorRef.current = null;
    compensationCancelableRef.current = false;
    compensationDeadlineRef.current = 0;
    restoreResolverRef.current = null;
    restoreDeadlineRef.current = 0;
    lastScrollTopRef.current = 0;
    lastContentHeightRef.current = 0;
    consumedAutoFollowBottomInsetRef.current = 0;
    userScrollIntentUntilRef.current = 0;
    // FR-2 (rung 6): restore a finalized session's saved reading position before
    // first paint; a streaming session, a missing plan, or a saved row now gone
    // bottom-pins (the conservative default). The frame writer then re-resolves
    // the anchor each glued frame so residual corrections land silently.
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
  }, [beginGlue, clearAllMarkers, notifyProgrammaticScroll, scrollRef, scrollToBottom, setPinned]);

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
