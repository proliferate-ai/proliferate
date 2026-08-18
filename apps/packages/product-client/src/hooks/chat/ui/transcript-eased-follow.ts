import {
  resolveTranscriptEasedFollowEnabled,
  TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY,
} from "#product/domain/chats/transcript/transcript-eased-follow-config";

/**
 * The eased-follow motion policy (PRO-168, design question Q16, rung 12).
 *
 * v1 ships instant glue: the pinned single writer (see
 * use-transcript-frame-pipeline-lifecycle.ts) snaps straight to the follow
 * target every pass. Founder Ruling Q16 keeps that as the default and specs the
 * motion layer as a PLUGGABLE writer policy so an eased, smoothed follower
 * can be swapped in later without touching classification (FR-1): this module
 * is that policy, a pure step function with no DOM or React dependency, so it
 * composes with the same single per-frame pipeline rather than adding a
 * competing rAF loop. The pipeline's `hasPendingMotion` writer hook (see
 * transcript-frame-pipeline.ts) keeps scheduling frames while a step here has
 * not yet converged; once converged the pipeline goes quiet exactly like the
 * instant writer already does.
 */

// Fraction of the remaining distance to the target closed per frame pass. A
// fixed per-frame fraction (rather than a wall-clock-driven ease) keeps the
// policy deterministic under the fake-frame harness the physics suite and unit
// tests already use, while still reading as a smooth catch-up rather than a
// jump: at 0.25/frame the remaining distance halves roughly every three
// frames (~50ms at 60fps).
export const TRANSCRIPT_EASED_FOLLOW_RATE = 0.25;

// Below this remaining distance, snap directly to the target and report
// converged rather than iterating an ever-shrinking geometric tail forever.
export const TRANSCRIPT_EASED_FOLLOW_CONVERGE_PX = 1;

export interface EasedFollowStep {
  /** The scrollTop this pass should write. */
  nextTop: number;
  /** True once nextTop === targetTop and no further motion frame is needed. */
  converged: boolean;
}

/**
 * One eased step toward `targetTop` from `currentTop`. Pure and stateless: the
 * caller re-derives `currentTop` from the live DOM each pass (the same
 * contract the instant writer already holds), so this never drifts from the
 * real scroll position even when something else briefly clamps it.
 */
export function resolveEasedFollowStep(currentTop: number, targetTop: number): EasedFollowStep {
  const delta = targetTop - currentTop;
  if (Math.abs(delta) <= TRANSCRIPT_EASED_FOLLOW_CONVERGE_PX) {
    return { nextTop: targetTop, converged: true };
  }
  return { nextTop: currentTop + delta * TRANSCRIPT_EASED_FOLLOW_RATE, converged: false };
}

/**
 * Read the flag once at mount (same convention as the virtualization-mode
 * flag). `window` access stays out of domain/ (the tsconfig.domain.json
 * DOM-free gate), so this reader lives in the hook layer, not alongside the
 * pure parser in transcript-eased-follow-config.ts.
 */
export function readTranscriptEasedFollowEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return resolveTranscriptEasedFollowEnabled(
    window.localStorage.getItem(TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY),
  );
}
