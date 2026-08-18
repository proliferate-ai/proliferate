/**
 * The single named follow-target derivation (PRO-187, rung 7 / design question
 * Q6). "Where the pinned viewport follows to" is derived here from the dock
 * inset model split (structural vs non-displacing, produced by
 * `resolveTranscriptBottomInsets`) rather than from ad-hoc inset math scattered
 * across the engine. Keeping it in one pure function is what lets the
 * consumed-inset state machine and the engine share one definition of the
 * target and never double-compensate for a dock change.
 */

/**
 * The dock inset as the model splits it (see `resolveTranscriptBottomInsets`).
 * Both halves already extend the viewport's `scrollHeight`: the structural half
 * as the virtualizer's `paddingEnd`, the non-displacing half as the absolute
 * bottom overlay spacer. The distinction is where the pinned follow lands:
 * the follow goes all the way to the bottom past the structural inset (the last
 * message sits just above the composer), but holds ABOVE the non-displacing
 * overlay range until the user deliberately consumes it, so a card stacked over
 * the composer never covers the newest content.
 */
export interface TranscriptDockInset {
  /** Structural (displacing) inset; reflected in scrollHeight as paddingEnd. */
  structuralInsetPx: number;
  /** Manual-only overlay inset; reflected in scrollHeight as the bottom spacer. */
  nonDisplacingInsetPx: number;
}

export interface TranscriptFollowTargetInput {
  scrollHeight: number;
  clientHeight: number;
  /** The dock inset model split (declared input, not recomputed here). */
  dockInset: TranscriptDockInset;
  /**
   * How much of the non-displacing overlay range the user has deliberately
   * consumed by reaching the hard bottom (button click or a bottom-band re-pin).
   */
  consumedNonDisplacingInsetPx: number;
}

/**
 * Resolve the scrollTop the transcript should follow to while pinned.
 *
 * The structural inset already extends scrollHeight (the virtualizer's
 * paddingEnd), so with no remaining manual overlay the pinned target is the raw
 * scrollHeight (browsers clamp it to their exact maximum scrollTop without
 * subpixel bookkeeping). Declaring the structural inset here, even though the
 * bottom-math reads it through scrollHeight, keeps this derivation the ONE place
 * that reasons about the dock inset: a caller that separately compensated for a
 * structural change on top of following scrollHeight would double-count it.
 *
 * A remaining non-displacing overlay range holds the follow that fixed distance
 * above the hard bottom.
 */
export function resolveTranscriptFollowTarget({
  scrollHeight,
  clientHeight,
  dockInset,
  consumedNonDisplacingInsetPx,
}: TranscriptFollowTargetInput): number {
  const remainingManualInsetPx = Math.max(
    0,
    Math.max(0, dockInset.nonDisplacingInsetPx) - Math.max(0, consumedNonDisplacingInsetPx),
  );
  if (remainingManualInsetPx <= 0) {
    return scrollHeight;
  }
  // The hard bottom already accounts for the structural inset (it lives in
  // scrollHeight); the manual overlay range is subtracted from there so the
  // follow stops at the top edge of the overlay spacer.
  const hardBottom = Math.max(0, scrollHeight - clientHeight);
  return Math.max(0, hardBottom - remainingManualInsetPx);
}
