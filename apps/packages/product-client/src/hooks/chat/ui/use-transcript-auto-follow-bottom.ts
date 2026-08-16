import {
  useCallback,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import { resolveVirtualBottomDistance } from "#product/domain/chats/transcript/transcript-virtual-rows";
import {
  DIRECTION_EPSILON_PX,
  PROGRAMMATIC_MATCH_TOL_PX,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import { resolveTranscriptFollowTarget } from "#product/hooks/chat/ui/transcript-follow-target";
import type { TranscriptPinTransitionCause } from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations";
import {
  initialTranscriptInsetState,
  reduceTranscriptInset,
  type TranscriptInsetEvent,
  type TranscriptInsetState,
  type TranscriptInsetTransition,
} from "#product/hooks/chat/ui/transcript-consumed-inset";

export interface UseTranscriptAutoFollowBottomOptions {
  /** The real scroll element ref (AutoHideScrollArea forwards its viewport here). */
  scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * Structural (displacing) dock inset: composer height, status bar, footer.
   * Reflected in scrollHeight as the virtualizer's paddingEnd. Declared here so
   * the consumed-inset machine can mark the upward clamp a structural shrink
   * (composer collapse) queues while pinned, instead of letting it be misread as
   * a user scroll (rung 7 / Q6).
   */
  structuralBottomInsetPx: number;
  /**
   * Manual-only scroll range created by cards overlaying the transcript. Auto
   * follow stops before this range until the user explicitly reaches the hard
   * bottom or clicks the scroll-to-bottom button.
   */
  nonDisplacingBottomInsetPx: number;
  /** Live pin state. */
  pinnedRef: RefObject<boolean>;
  setPinned: (pinned: boolean, cause?: TranscriptPinTransitionCause) => void;
  /** Owned by the caller: last observed scrollTop, used for direction detection. */
  lastScrollTopRef: MutableRefObject<number>;
  /** Record a write as our own, not the user's, before its scroll event arrives. */
  markNonUserScrollPosition: (viewport: HTMLDivElement) => void;
  /** Wrap ANY external scrollTop write so its scroll event is excluded from pin/direction. */
  notifyProgrammaticScroll: (write: () => void) => void;
}

export interface TranscriptAutoFollowBottom {
  /**
   * The consumed-inset state (dock inset split + consumed overlay range). The
   * caller's scroll classification reads it (follow target) and drives its
   * transitions through `dispatchInsetEvent`. See transcript-consumed-inset.ts.
   */
  insetStateRef: MutableRefObject<TranscriptInsetState>;
  /**
   * Apply a named consumed-inset transition (leave_band, consume_full,
   * submit_repin, reset). `dock_inset_changed` is dispatched internally by the
   * dock-geometry layout effect below. Returns the transition so a caller that
   * needs the structural-shrink-clamp signal can act on it.
   */
  dispatchInsetEvent: (event: TranscriptInsetEvent) => TranscriptInsetTransition;
  /** Snap to the active follow target (soft overlay bottom or user-chosen hard bottom). */
  scrollToBottom: () => void;
  /** Snap + re-pin, for the scroll-to-bottom button. */
  handleScrollToBottomClick: () => void;
}

/**
 * Owns the consumed-inset state machine: the dock inset split (structural vs
 * manual-only overlay) and how much of the overlay range the user has consumed,
 * plus the follow-target math (see transcript-follow-target.ts) that keeps the
 * pinned follow above the overlay until the user deliberately consumes it. Split
 * out of useTranscriptStickToBottom as a cohesive, independently-testable seam
 * (PRO-187, rung 7 / Q6).
 */
export function useTranscriptAutoFollowBottom({
  scrollRef,
  structuralBottomInsetPx,
  nonDisplacingBottomInsetPx,
  pinnedRef,
  lastScrollTopRef,
  markNonUserScrollPosition,
  notifyProgrammaticScroll,
  setPinned,
}: UseTranscriptAutoFollowBottomOptions): TranscriptAutoFollowBottom {
  const insetStateRef = useRef<TranscriptInsetState>(
    initialTranscriptInsetState({
      structuralInsetPx: structuralBottomInsetPx,
      nonDisplacingInsetPx: nonDisplacingBottomInsetPx,
    }),
  );

  const dispatchInsetEvent = useCallback(
    (event: TranscriptInsetEvent): TranscriptInsetTransition => {
      const transition = reduceTranscriptInset(insetStateRef.current, event);
      insetStateRef.current = transition.state;
      return transition;
    },
    [],
  );

  // Registered before consumer layout effects. Routes the new dock geometry
  // through the consumed-inset machine (which caps the consumed range and flags
  // a structural shrink) and, while pinned, marks the upward clamp a shrink
  // queues so it cannot be misread as the user scrolling up or wrongly consume
  // the overlay (rung 7 / Q6: an inset that appears/disappears does not fight
  // the reader or double-compensate).
  useLayoutEffect(() => {
    const previous = insetStateRef.current;
    const transition = dispatchInsetEvent({
      type: "dock_inset_changed",
      structuralInsetPx: structuralBottomInsetPx,
      nonDisplacingInsetPx: nonDisplacingBottomInsetPx,
    });
    const viewport = scrollRef.current;
    if (!viewport || !pinnedRef.current) {
      return;
    }
    const overlayShrankConsumed =
      transition.state.nonDisplacingInsetPx < previous.nonDisplacingInsetPx &&
      previous.consumedNonDisplacingInsetPx > 0;
    if (!(transition.structuralShrinkClamp || overlayShrankConsumed)) {
      return;
    }
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
  }, [
    dispatchInsetEvent,
    lastScrollTopRef,
    markNonUserScrollPosition,
    nonDisplacingBottomInsetPx,
    pinnedRef,
    scrollRef,
    structuralBottomInsetPx,
  ]);

  const scrollToBottom = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      return;
    }
    const state = insetStateRef.current;
    const requestedTop = resolveTranscriptFollowTarget({
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      dockInset: {
        structuralInsetPx: state.structuralInsetPx,
        nonDisplacingInsetPx: state.nonDisplacingInsetPx,
      },
      consumedNonDisplacingInsetPx: state.consumedNonDisplacingInsetPx,
    });
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
  }, [lastScrollTopRef, notifyProgrammaticScroll, scrollRef]);

  const handleScrollToBottomClick = useCallback(() => {
    dispatchInsetEvent({ type: "consume_full" });
    setPinned(true, "button_click");
    scrollToBottom();
  }, [dispatchInsetEvent, scrollToBottom, setPinned]);

  return {
    insetStateRef,
    dispatchInsetEvent,
    scrollToBottom,
    handleScrollToBottomClick,
  };
}
