import type { RefObject } from "react";
import type {
  ContentHeightScrollAnchor,
  TranscriptScrollSample,
} from "#product/hooks/chat/ui/transcript-row-list-model";
import type { TranscriptSessionRestorePlan } from "#product/hooks/chat/ui/transcript-reading-position-store";

/**
 * Split out of use-transcript-stick-to-bottom.ts (capped near 400 lines,
 * PRO-187) so the option/return contracts have room to document each field
 * without pushing the engine itself over the split threshold.
 */
export interface UseTranscriptStickToBottomOptions {
  /** The real scroll element ref (AutoHideScrollArea forwards its viewport here). */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Perf probe; must run on every scroll, user or programmatic. */
  onScrollSample: (sample?: TranscriptScrollSample) => void;
  /** px from the bottom within which a user scroll re-pins. */
  repinThresholdPx?: number;
  /**
   * Structural (displacing) dock inset (composer, status bar, footer), reflected
   * in scrollHeight as the virtualizer paddingEnd. Fed to the consumed-inset
   * machine so a structural shrink marks its clamp while pinned (rung 7 / Q6).
   */
  structuralBottomInsetPx?: number;
  /**
   * Manual-only overlay range created by cards overlaying the transcript. Auto
   * follow stops before it until the user reaches the hard bottom.
   */
  nonDisplacingBottomInsetPx?: number;
  /**
   * Epoch ms of the newest prompt submission (outbox enqueue or session-level
   * optimistic prompt). A monotonic increase re-pins: sending is an explicit
   * return-to-bottom intent. Entries leaving the outbox (delivery, dismissal)
   * can only lower the stamp and must not re-pin.
   */
  lastPromptSubmittedAtMs?: number | null;
  /**
   * Identity of the session/workspace currently mounted. Row lists never remount
   * across a session switch, so `lastPromptSubmittedAtMs` alone can't tell "fresh
   * submit here" from "incoming session's own stamp carried over"; a change here
   * re-baselines submit-stamp tracking instead of comparing across the switch.
   */
  sessionKey?: string;
}

export interface TranscriptStickToBottom {
  /** True while pinned to the bottom; drives the scroll-to-bottom button. */
  isPinnedToBottom: boolean;
  /**
   * True when content grew (a real ResizeObserver-measured resize, not an
   * estimate) while unpinned: the scroll-to-latest button's new-content
   * variant (Q18, rung 9). Cleared on re-pin (any path) and session reset, so
   * it never survives past the content it announced.
   */
  hasNewContentWhileUnpinned: boolean;
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
   * Hold anchored content in place while a freshly-inserted row above measures
   * in, via the single frame pipeline: applies the measured scrollHeight delta
   * each frame while unpinned until the compensation deadline lapses (no-op pinned).
   */
  startAboveChangeCompensation: (anchor: ContentHeightScrollAnchor, cancelableByUpwardIntent: boolean) => void;
  /**
   * Cancel the pending frame pass / glue window. Registered as the transcript's
   * synchronous scroll-pause listener so a user scroll inside the input event's
   * call stack pre-empts any queued programmatic snap.
   */
  cancelFramePipeline: () => void;
}
