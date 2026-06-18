import { useEffect, useRef } from "react";
import { useUpdaterStore } from "@/stores/updater/updater-store";
import { useRunningAgentCount } from "@/hooks/app/lifecycle/use-running-agent-count";
import { isTauriPackaged, relaunch } from "@/lib/access/tauri/updater";

// Once the user picks "Restart when they finish", wait until the app is genuinely idle
// before relaunching. The short debounce avoids relaunching on a transient gap between
// sessions (e.g. one finishes a beat before the next starts).
const IDLE_DEBOUNCE_MS = 5_000;

/**
 * Drives the deferred update restart. When an update is `ready` and the user armed
 * "restart when they finish", this relaunches the moment no local sessions are running
 * (held stable for IDLE_DEBOUNCE_MS). Mount once, at the app root.
 */
export function useUpdateRestartWatcher(): void {
  const phase = useUpdaterStore((s) => s.phase);
  const restartWhenIdle = useUpdaterStore((s) => s.restartWhenIdle);
  const runningCount = useRunningAgentCount();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const armed = isTauriPackaged() && restartWhenIdle && phase === "ready";
    if (!armed || runningCount > 0) {
      clear();
      return;
    }

    timerRef.current = window.setTimeout(() => {
      void relaunch();
    }, IDLE_DEBOUNCE_MS);

    return clear;
  }, [phase, restartWhenIdle, runningCount]);
}
