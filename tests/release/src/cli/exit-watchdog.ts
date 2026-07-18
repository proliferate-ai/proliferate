const DEFAULT_EXIT_WATCHDOG_MS = 10_000;

export interface ExitWatchdogOptions {
  graceMs?: number;
  activeResources?: () => readonly string[];
  terminate?: (code: number) => never;
  error?: (message: string) => void;
}

/**
 * Arms a last-resort guard after the authoritative report and awaited cleanup
 * have completed. The timer is unref'd, so a healthy runner exits naturally.
 * It only fires when some other leaked handle is still keeping Node alive.
 */
export function armPostReportExitWatchdog(options: ExitWatchdogOptions = {}): NodeJS.Timeout {
  const graceMs = options.graceMs ?? DEFAULT_EXIT_WATCHDOG_MS;
  const activeResources = options.activeResources ?? (() => process.getActiveResourcesInfo());
  const terminate = options.terminate ?? ((code: number): never => process.exit(code));
  const error = options.error ?? ((message: string) => console.error(message));

  const timer = setTimeout(() => {
    const resources = [...new Set(activeResources())].sort();
    const suffix = resources.length > 0 ? resources.join(", ") : "unknown";
    error(
      `[release-e2e] process did not quiesce within ${graceMs}ms after report completion; `
        + `forcing infrastructure exit 2 (active resources: ${suffix})`,
    );
    terminate(2);
  }, graceMs);
  timer.unref();
  return timer;
}
