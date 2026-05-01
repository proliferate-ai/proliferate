import type {
  WorkspacePurgeResponse,
  WorkspaceRetireResponse,
} from "@anyharness/sdk";

type WorktreeSettingsActionResult = WorkspaceRetireResponse | WorkspacePurgeResponse | unknown;

export function worktreeSettingsActionFailureMessage(
  result: WorktreeSettingsActionResult,
): string | null {
  if (!result || typeof result !== "object" || !("outcome" in result)) {
    return null;
  }
  const outcome = String(result.outcome);
  const cleanupMessage = "cleanupMessage" in result && typeof result.cleanupMessage === "string"
    ? result.cleanupMessage.trim()
    : "";
  if (
    outcome !== "blocked"
    && outcome !== "cleanup_failed"
    && (!("cleanupSucceeded" in result) || result.cleanupSucceeded !== false || cleanupMessage.length === 0)
  ) {
    return null;
  }
  const preflight = "preflight" in result && result.preflight && typeof result.preflight === "object"
    ? result.preflight
    : null;
  const blockers = preflight && "blockers" in preflight && Array.isArray(preflight.blockers)
    ? preflight.blockers
    : [];
  const firstBlocker = blockers.find((blocker) =>
    blocker && typeof blocker === "object" && "message" in blocker && typeof blocker.message === "string"
  );
  if (firstBlocker && typeof firstBlocker === "object" && "message" in firstBlocker) {
    const message = String(firstBlocker.message);
    const extraCount = blockers.length - 1;
    return extraCount > 0 ? `${message} (+${extraCount} more)` : message;
  }

  if (cleanupMessage.length > 0) {
    return cleanupMessage;
  }
  return outcome === "blocked" ? "Workspace action was blocked." : "Workspace cleanup failed.";
}
