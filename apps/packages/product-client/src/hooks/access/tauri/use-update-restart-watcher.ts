import { useEffect, useRef } from "react";
import type { DesktopUpdaterBridge } from "@proliferate/product-client/host/desktop-updater-bridge";
import { useUpdaterStore } from "#product/stores/updater/updater-store";
import { useRunningAgentCount } from "#product/hooks/app/lifecycle/use-running-agent-count";

// Once the user picks "Restart when they finish", wait until the app is genuinely idle
// before relaunching. The short debounce avoids relaunching on a transient gap between
// sessions (e.g. one finishes a beat before the next starts).
const IDLE_DEBOUNCE_MS = 5_000;

/**
 * How long the user gets to stop a deferred relaunch once the app goes idle.
 * Arming "restart when they finish" used to mean the window could vanish with no
 * notice at all; the countdown toast announces this interval, and cancelling it
 * disarms the deferred restart entirely.
 */
export const RESTART_COUNTDOWN_MS = 10_000;

/**
 * Drives the deferred update restart. When an update is `ready` and the user armed
 * "restart when they finish", the app going idle (held stable for
 * IDLE_DEBOUNCE_MS) starts a visible, cancellable countdown; only the countdown
 * expiring relaunches. Mount once, at the app root.
 */
export function useUpdateRestartWatcher(updater: DesktopUpdaterBridge): void {
  const phase = useUpdaterStore((s) => s.phase);
  const restartWhenIdle = useUpdaterStore((s) => s.restartWhenIdle);
  const countdownStartedAt = useUpdaterStore((s) => s.restartCountdownStartedAt);
  const runningCount = useRunningAgentCount();
  const timerRef = useRef<number | null>(null);

  const armed = updater.isSupported() && restartWhenIdle && phase === "ready";

  // Idle held long enough → start the countdown. This step only announces; it
  // never relaunches, so the warning window can't be skipped.
  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    if (!armed || runningCount > 0 || countdownStartedAt !== null) {
      clear();
      return;
    }

    timerRef.current = window.setTimeout(() => {
      useUpdaterStore.getState().startRestartCountdown(Date.now());
    }, IDLE_DEBOUNCE_MS);

    return clear;
  }, [armed, countdownStartedAt, runningCount]);

  // Countdown expired without a cancel → relaunch. Cancelling clears
  // `restartCountdownStartedAt` (and disarms), which tears this timer down.
  useEffect(() => {
    if (!armed || countdownStartedAt === null) {
      return;
    }
    const remaining = Math.max(
      0,
      RESTART_COUNTDOWN_MS - (Date.now() - countdownStartedAt),
    );
    const timer = window.setTimeout(() => {
      void updater.relaunch();
    }, remaining);
    return () => {
      window.clearTimeout(timer);
    };
  }, [armed, countdownStartedAt, updater]);
}
