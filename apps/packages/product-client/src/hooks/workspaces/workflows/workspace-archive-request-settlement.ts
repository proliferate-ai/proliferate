import { AnyHarnessError, type WorkspaceUnarchiveScenarioBody } from "@anyharness/sdk";
import { motion } from "@proliferate/design/motion";

const ARCHIVE_SETTLE_TIMEOUT_MS = motion.delay.optimisticSettleTimeoutMs;

export const ARCHIVE_TIMEOUT = Symbol("archive-request-timeout");

export async function waitForArchiveSettlement<T>(
  promise: Promise<T>,
): Promise<T | typeof ARCHIVE_TIMEOUT> {
  // A rejection after the timeout wins must not become unhandled. At that
  // point the pending archive reconciler owns the eventual outcome.
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof ARCHIVE_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(ARCHIVE_TIMEOUT), ARCHIVE_SETTLE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function readUnarchiveScenario(error: unknown): WorkspaceUnarchiveScenarioBody | null {
  if (!(error instanceof AnyHarnessError) || error.problem.code !== "WORKSPACE_UNARCHIVE_SCENARIO") {
    return null;
  }
  const extra = error.problem.extra;
  if (!extra || typeof extra !== "object") {
    return null;
  }
  return extra as WorkspaceUnarchiveScenarioBody;
}

export function readGitLockedFile(error: unknown): string {
  if (error instanceof AnyHarnessError && error.problem.extra && typeof error.problem.extra === "object") {
    const file = (error.problem.extra as { file?: unknown }).file;
    if (typeof file === "string" && file.trim()) {
      return file;
    }
  }
  return "a lock file";
}
