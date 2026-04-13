import { useSyncExternalStore } from "react";

/**
 * Braille diagonal-sweep frames. The cycle goes:
 *   empty → fill bottom-left → fill diagonally → full → drain top-right → empty
 * Reused across the loading vocabulary so every consumer animates in
 * lockstep — the transcript StreamingIndicator, the ChatLoadingHero, and
 * the chat tab badges.
 */
export const BRAILLE_SWEEP_FRAMES = [
  "⠁⠀", "⠋⠀", "⠟⠁", "⡿⠋", "⣿⠟", "⣿⡿", "⣿⣿", "⣿⣿",
  "⣾⣿", "⣴⣿", "⣠⣾", "⢀⣴", "⠀⣠", "⠀⢀", "⠀⠀", "⠀⠀",
] as const;

export const BRAILLE_SWEEP_FRAME_INTERVAL_MS = 60;

/** Frame index 6 — fully filled. Used as the static "landed" mark. */
export const BRAILLE_SWEEP_LANDED_FRAME = BRAILLE_SWEEP_FRAMES[6];

// Single shared ticker. Every useBrailleSweep() consumer subscribes to this
// one frame counter via useSyncExternalStore, so the timer runs exactly once
// regardless of how many tabs/indicators are alive, and every spinner is
// guaranteed to be in phase with every other one. The interval is started
// lazily on the first subscriber and stopped when the last one unmounts.
let frameIndex = 0;
let timerId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function startTicker(): void {
  if (timerId !== null) return;
  timerId = setInterval(() => {
    frameIndex = (frameIndex + 1) % BRAILLE_SWEEP_FRAMES.length;
    listeners.forEach((listener) => listener());
  }, BRAILLE_SWEEP_FRAME_INTERVAL_MS);
}

function stopTicker(): void {
  if (timerId === null) return;
  clearInterval(timerId);
  timerId = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startTicker();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTicker();
    }
  };
}

function getSnapshot(): number {
  return frameIndex;
}

export function useBrailleSweep(): string {
  const index = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return BRAILLE_SWEEP_FRAMES[index];
}

/* ─────────────────────────────────────────────────────
 * Alternate braille loading animations.
 *
 * Each variant gets its own module-level ticker (constructed via
 * `createBrailleAnimation`) so its cadence is independent of the others,
 * but still frame-synchronized across all of its own consumers via the
 * same lazy-start / lazy-stop / useSyncExternalStore pattern as the
 * default sweep above. Adding a new variant is a single `createBrailleAnimation`
 * call — do NOT modify the default sweep implementation above.
 * ───────────────────────────────────────────────────── */

function createBrailleAnimation(
  frames: readonly string[],
  intervalMs: number,
): { use: () => string } {
  let index = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const subs = new Set<() => void>();

  const start = () => {
    if (timer !== null) return;
    timer = setInterval(() => {
      index = (index + 1) % frames.length;
      subs.forEach((listener) => listener());
    }, intervalMs);
  };

  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  const subscribe = (listener: () => void) => {
    subs.add(listener);
    start();
    return () => {
      subs.delete(listener);
      if (subs.size === 0) stop();
    };
  };

  const getSnapshot = () => index;

  return {
    use: () =>
      frames[useSyncExternalStore(subscribe, getSnapshot, getSnapshot)],
  };
}

/** fillsweep — fills the grid top-down in chunky horizontal bars, holds
 *  fully-lit for three frames, then drains back to empty. 11 frames @ 100ms. */
export const BRAILLE_FILLSWEEP_FRAMES = [
  "⣀⣀", "⣤⣤", "⣶⣶", "⣿⣿", "⣿⣿", "⣿⣿", "⣶⣶", "⣤⣤", "⣀⣀", "⠀⠀", "⠀⠀",
] as const;
export const BRAILLE_FILLSWEEP_FRAME_INTERVAL_MS = 100;
export const BRAILLE_FILLSWEEP_LANDED_FRAME = BRAILLE_FILLSWEEP_FRAMES[3];

const fillsweepAnim = createBrailleAnimation(
  BRAILLE_FILLSWEEP_FRAMES,
  BRAILLE_FILLSWEEP_FRAME_INTERVAL_MS,
);
export const useBrailleFillsweep = fillsweepAnim.use;

/** snake — a single curve that coils down through the two-char grid.
 *  16 frames @ 80ms. No "fully lit" moment, so there is no landed frame. */
export const BRAILLE_SNAKE_FRAMES = [
  "⣁⡀", "⣉⠀", "⡉⠁", "⠉⠉", "⠈⠙", "⠀⠛", "⠐⠚", "⠒⠒",
  "⠖⠂", "⠶⠀", "⠦⠄", "⠤⠤", "⠠⢤", "⠀⣤", "⢀⣠", "⣀⣀",
] as const;
export const BRAILLE_SNAKE_FRAME_INTERVAL_MS = 80;

const snakeAnim = createBrailleAnimation(
  BRAILLE_SNAKE_FRAMES,
  BRAILLE_SNAKE_FRAME_INTERVAL_MS,
);
export const useBrailleSnake = snakeAnim.use;

/** cascade — begins fully filled, then drops off in sweeping diagonal bands.
 *  Intended for handoff completion and reveal states. 12 frames @ 90ms. */
export const BRAILLE_CASCADE_FRAMES = [
  "⣿⣿", "⣿⣷", "⣾⣿", "⣶⣷", "⣴⣶", "⣤⣦",
  "⣀⣤", "⠀⣄", "⠀⠄", "⠀⠂", "⠀⠀", "⠀⠀",
] as const;
export const BRAILLE_CASCADE_FRAME_INTERVAL_MS = 90;
export const BRAILLE_CASCADE_LANDED_FRAME = BRAILLE_CASCADE_FRAMES[0];

const cascadeAnim = createBrailleAnimation(
  BRAILLE_CASCADE_FRAMES,
  BRAILLE_CASCADE_FRAME_INTERVAL_MS,
);
export const useBrailleCascade = cascadeAnim.use;
