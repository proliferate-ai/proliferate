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
