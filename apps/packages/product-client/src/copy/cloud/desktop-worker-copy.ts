const WORKER_CREDENTIALS_LOCKED_DETAIL =
  "Cannot replace worker credentials while a Proliferate Worker is still running.";

export type DesktopWorkerStartupFailureKind =
  | "credentials_locked"
  | "startup_failed";

export interface DesktopWorkerStartupFailureNotice {
  kind: DesktopWorkerStartupFailureKind;
  headline: string;
  consequence: string;
  cause: string;
}

export function desktopWorkerStartupFailureNotice(
  error: unknown,
): DesktopWorkerStartupFailureNotice {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const cause = detail.trim().length > 0 ? detail.trim() : "Unknown error";
  const credentialsLocked = cause.includes(WORKER_CREDENTIALS_LOCKED_DETAIL);

  return {
    kind: credentialsLocked ? "credentials_locked" : "startup_failed",
    headline: "Integrations unavailable",
    consequence: credentialsLocked
      ? "An earlier Proliferate Worker is still running. Quit other Proliferate apps; if none are open, restart your computer, then retry."
      : "Proliferate will keep trying in the background. Retry now, or dismiss this notice.",
    cause,
  };
}
