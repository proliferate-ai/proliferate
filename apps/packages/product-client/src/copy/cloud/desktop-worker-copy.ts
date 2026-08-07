/**
 * The startup-failure report, split the way `showError` demands: a fixed
 * headline, the consequence, and the exception as a separate `cause` that only
 * the Details strip renders. The old single-string form interpolated the
 * exception into the headline — the exact shape the toast redesign retired.
 *
 * The id is stable so the enrollment retry loop replaces its live toast
 * instead of stacking an identical report per attempt.
 */
export const DESKTOP_WORKER_STARTUP_FAILURE_TOAST_ID = "desktop-worker-startup";

export const DESKTOP_WORKER_STARTUP_FAILURE_HEADLINE =
  "Cloud integrations worker failed to start";

export const DESKTOP_WORKER_STARTUP_FAILURE_CONSEQUENCE =
  "Cloud workspaces are unavailable until it starts.";

export function desktopWorkerStartupFailureCause(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return detail.trim().length > 0 ? detail.trim() : "Unknown error";
}
