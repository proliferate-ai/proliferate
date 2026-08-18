/**
 * The consumed-inset state machine (PRO-187, rung 7 / design question Q6).
 *
 * Q6 rules the consumed-inset semantics as state-machine transitions rather
 * than scattered ref writes: a prompt submit does NOT consume the overlay, the
 * scroll-to-bottom button (and a bottom-band re-pin that reaches the hard
 * bottom) consumes it in full, and leaving the bottom band resets it. This pure
 * reducer is the one place those transitions live, with the dock inset split
 * (structural vs non-displacing, from `resolveTranscriptBottomInsets`) as its
 * declared input.
 */
import type { TranscriptDockInset } from "#product/hooks/chat/ui/transcript-follow-target";

export interface TranscriptInsetState extends TranscriptDockInset {
  /**
   * How much of the non-displacing overlay range the user has deliberately
   * consumed by reaching the hard bottom (0 = none).
   */
  consumedNonDisplacingInsetPx: number;
}

export type TranscriptInsetEvent =
  /** Session switch / restore: forget any consumed range. */
  | { type: "reset" }
  /** The user genuinely left the bottom band: the overlay is manual-only again. */
  | { type: "leave_band" }
  /** Button click or a bottom-band re-pin reaching the hard bottom: consume all. */
  | { type: "consume_full" }
  /** A prompt submit re-pins but, by ruling, does NOT consume the overlay. */
  | { type: "submit_repin" }
  /** The dock reported new geometry (composer growth/collapse, status bar). */
  | {
    type: "dock_inset_changed";
    structuralInsetPx: number;
    nonDisplacingInsetPx: number;
  };

export interface TranscriptInsetTransition {
  state: TranscriptInsetState;
  /**
   * True when a `dock_inset_changed` shrank the STRUCTURAL (displacing) inset:
   * scrollHeight just shrank, so a pinned viewport will be clamped upward to the
   * new, shorter hard bottom. The engine must mark that queued clamp as its own
   * write so it cannot be misread as the user scrolling up (no fight) and cannot
   * wrongly consume the overlay through the "at hard bottom" pin path. Only ever
   * set on a structural shrink; a structural grow needs no marking (the pinned
   * snap simply follows the taller document).
   */
  structuralShrinkClamp: boolean;
}

export function initialTranscriptInsetState(
  dockInset: TranscriptDockInset,
): TranscriptInsetState {
  return {
    structuralInsetPx: Math.max(0, dockInset.structuralInsetPx),
    nonDisplacingInsetPx: Math.max(0, dockInset.nonDisplacingInsetPx),
    consumedNonDisplacingInsetPx: 0,
  };
}

export function reduceTranscriptInset(
  state: TranscriptInsetState,
  event: TranscriptInsetEvent,
): TranscriptInsetTransition {
  switch (event.type) {
    case "reset":
    case "leave_band":
      return {
        state: { ...state, consumedNonDisplacingInsetPx: 0 },
        structuralShrinkClamp: false,
      };
    case "consume_full":
      return {
        state: {
          ...state,
          consumedNonDisplacingInsetPx: state.nonDisplacingInsetPx,
        },
        structuralShrinkClamp: false,
      };
    case "submit_repin":
      // Ruled no-op: a submit re-pins (handled by the caller) but leaves the
      // consumed range exactly as it was, so a range the user already consumed
      // stays consumed and the stream never slides under a dock-slot card.
      return { state, structuralShrinkClamp: false };
    case "dock_inset_changed": {
      const nextStructural = Math.max(0, event.structuralInsetPx);
      const nextNonDisplacing = Math.max(0, event.nonDisplacingInsetPx);
      return {
        state: {
          structuralInsetPx: nextStructural,
          nonDisplacingInsetPx: nextNonDisplacing,
          // A shrinking overlay can only leave AT MOST the new range consumed;
          // if another card stacked above the composer, only the NEW height is
          // manual-only, so the already-consumed portion is preserved capped.
          consumedNonDisplacingInsetPx: Math.min(
            state.consumedNonDisplacingInsetPx,
            nextNonDisplacing,
          ),
        },
        structuralShrinkClamp: nextStructural < state.structuralInsetPx,
      };
    }
    default: {
      const exhaustive: never = event;
      void exhaustive;
      return { state, structuralShrinkClamp: false };
    }
  }
}
