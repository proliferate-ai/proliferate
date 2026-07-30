import { useEffect, useState } from "react";

const TICK_MS = 1_000;

/**
 * Ticking `Date.now()` at second resolution, for copy that states an elapsed or
 * remaining duration.
 *
 * A number rendered from a one-shot `Date.now()` inside an effect freezes at the
 * value it had when that effect last ran, which is worse than showing nothing:
 * "No data for 8 seconds" on a download that died five minutes ago actively
 * misinforms the wait-or-retry decision the copy exists to support.
 *
 * `active` gates the timer rather than the caller gating the hook, because the
 * states that need a clock are transient — a stall, a countdown — and a timer
 * that ran whenever the presenter was mounted would tick for the entire session
 * to serve a state that is visible for seconds. Passing `false` stops the
 * interval and leaves the last value in place.
 *
 * Separate from `useActivityNowMs`, which ticks every 15s for panels where a
 * per-second re-render would be pure cost.
 */
export function useTickingSeconds(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }
    // Re-read immediately: the state may have been entered long after the last
    // tick, and the first render of the copy should not be a stale second.
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [active]);

  return nowMs;
}
