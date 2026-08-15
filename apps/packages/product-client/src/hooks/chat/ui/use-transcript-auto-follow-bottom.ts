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
import { resolveAutoFollowScrollTop } from "#product/hooks/chat/ui/transcript-auto-follow-target";

export interface UseTranscriptAutoFollowBottomOptions {
  /** The real scroll element ref (AutoHideScrollArea forwards its viewport here). */
  scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * Manual-only scroll range created by cards overlaying the transcript. Auto
   * follow stops before this range until the user explicitly reaches the hard
   * bottom or clicks the scroll-to-bottom button.
   */
  autoFollowBottomInsetPx: number;
  /** Live pin state. */
  pinnedRef: RefObject<boolean>;
  setPinned: (pinned: boolean) => void;
  /** Owned by the caller: last observed scrollTop, used for direction detection. */
  lastScrollTopRef: MutableRefObject<number>;
  /** Record a write as our own, not the user's, before its scroll event arrives. */
  markNonUserScrollPosition: (viewport: HTMLDivElement) => void;
  /** Wrap ANY external scrollTop write so its scroll event is excluded from pin/direction. */
  notifyProgrammaticScroll: (write: () => void) => void;
}

export interface TranscriptAutoFollowBottom {
  /**
   * How much of the manual-only overlay range the user has deliberately
   * consumed by scrolling past it (0 = none). Exposed so the caller's scroll
   * classification can clear it on unpin and read it on re-pin.
   */
  consumedAutoFollowBottomInsetRef: MutableRefObject<number>;
  /** Consume the full remaining inset (a repin that reaches the hard bottom). */
  consumeFullInset: () => void;
  /** Snap to the active follow target (soft overlay bottom or user-chosen hard bottom). */
  scrollToBottom: () => void;
  /** Snap + re-pin, for the scroll-to-bottom button. */
  handleScrollToBottomClick: () => void;
}

/**
 * Owns the auto-follow-bottom inset: the manual-only scroll range a card
 * overlaying the transcript creates, and the scrollTop math (see
 * transcript-auto-follow-target.ts) that keeps the pinned follow above it
 * until the user deliberately consumes it. Split out of
 * useTranscriptStickToBottom as a cohesive, independently-testable seam.
 */
export function useTranscriptAutoFollowBottom({
  scrollRef,
  autoFollowBottomInsetPx,
  pinnedRef,
  setPinned,
  lastScrollTopRef,
  markNonUserScrollPosition,
  notifyProgrammaticScroll,
}: UseTranscriptAutoFollowBottomOptions): TranscriptAutoFollowBottom {
  const autoFollowBottomInsetRef = useRef(Math.max(0, autoFollowBottomInsetPx));
  const consumedAutoFollowBottomInsetRef = useRef(0);

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
  }, [autoFollowBottomInsetPx, lastScrollTopRef, markNonUserScrollPosition, pinnedRef, scrollRef]);

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
  }, [lastScrollTopRef, notifyProgrammaticScroll, scrollRef]);

  const handleScrollToBottomClick = useCallback(() => {
    consumedAutoFollowBottomInsetRef.current = autoFollowBottomInsetRef.current;
    setPinned(true);
    scrollToBottom();
  }, [scrollToBottom, setPinned]);

  const consumeFullInset = useCallback(() => {
    consumedAutoFollowBottomInsetRef.current = autoFollowBottomInsetRef.current;
  }, []);

  return {
    consumedAutoFollowBottomInsetRef,
    consumeFullInset,
    scrollToBottom,
    handleScrollToBottomClick,
  };
}
