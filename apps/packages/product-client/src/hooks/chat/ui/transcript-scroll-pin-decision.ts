import {
  DIRECTION_EPSILON_PX,
  PROGRAMMATIC_MATCH_TOL_PX,
} from "#product/hooks/chat/ui/transcript-row-list-model";

/**
 * The pin decision for a transcript scroll event that no ownership marker
 * claimed. Pure: it reads only the event's geometry and the live pin state and
 * returns what the engine should do, so the stick-to-bottom hook stays focused
 * on wiring (refs, listeners, snaps) and this classification can be unit-tested
 * in isolation.
 */
export interface TranscriptPinDecisionInput {
  /** Distance from the hard bottom, in px (0 = at the bottom). */
  distance: number;
  /** scrollTop delta since the previous processed event (positive = downward). */
  delta: number;
  /**
   * Whether the content changed size since the last processed baseline. A pinned
   * snap can only write once per frame, so when a batch GROWS the transcript
   * faster than the snap catches up the event reports a bottom-distance beyond
   * the repin band — not because the user moved away, but because our own follow
   * is a frame behind a taller document. A measurement correction that SHRINKS
   * the content is the mirror image (the browser clamps scrollTop down, reading
   * as an upward delta though the viewport never left the bottom).
   */
  scrollHeightChanged: boolean;
  /** Live pin state. */
  pinned: boolean;
  /** px band within which a downward return re-pins. */
  repinThresholdPx: number;
}

/**
 * - `true`  → pin. `consumeInset: "full"` claims the whole auto-follow inset
 *   (we are at the hard bottom); `"keep"` leaves the consumed inset untouched
 *   (the user returned into the band but not to the exact bottom).
 * - `false` → unpin (a genuine user displacement).
 * - `"hold"` → leave pin and inset exactly as they are (our own resize lag).
 */
export type TranscriptPinDecision =
  | { pin: true; consumeInset: "full" | "keep" }
  | { pin: false }
  | { pin: "hold" };

/**
 * Classify an unattributed transcript scroll event into a pin decision.
 *
 * Neither a grow nor a shrink is a user scroll: a user scroll never changes
 * scrollHeight, and any genuine upward gesture unpins synchronously through the
 * intent listener before its scroll event reaches here. So while pinned, an
 * event that coincides with a content-size change is our own follow and HOLDS
 * the pin — UNLESS it is an upward, off-bottom move. That direction gate lets a
 * scrollbar-thumb DRAG up during streaming (which skips the synchronous intent
 * listener) still unpin the reader instead of being absorbed as resize lag; the
 * hold applies only to downward/flat movement or when essentially at the hard
 * bottom. A genuine user displacement opens a bottom-distance with NO resize, so
 * it still unpins.
 */
export function decideTranscriptScrollPin({
  distance,
  delta,
  scrollHeightChanged,
  pinned,
  repinThresholdPx,
}: TranscriptPinDecisionInput): TranscriptPinDecision {
  const atHardBottom = distance <= PROGRAMMATIC_MATCH_TOL_PX;
  const movingDownOrFlat = delta > -DIRECTION_EPSILON_PX;
  const holdForContentChange =
    pinned && scrollHeightChanged && (movingDownOrFlat || atHardBottom);

  if (distance > repinThresholdPx) {
    // Beyond the repin band. A user reading away from the bottom unpins — but
    // while pinned, resize-driven lag is our own snap, not the user, so hold.
    return holdForContentChange ? { pin: "hold" } : { pin: false };
  }
  if (atHardBottom) {
    // Essentially at the hard bottom: a hair of upward delta here is a
    // shrink/clamp or measurement correction, never a user leaving. Stay pinned
    // and claim the full inset.
    return { pin: true, consumeInset: "full" };
  }
  if (movingDownOrFlat) {
    // Within the bottom band and not moving up — the user returned to bottom.
    return { pin: true, consumeInset: "keep" };
  }
  // Within the band, off the hard bottom, and moving up — the user is genuinely
  // leaving (an inset shrink that lands clear of the bottom still reads as a
  // real departure). Unpin.
  return { pin: false };
}
