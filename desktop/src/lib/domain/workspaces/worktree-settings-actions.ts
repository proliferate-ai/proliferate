import type {
  RunWorktreeRetentionResponse,
  WorktreeRetentionRowOutcome,
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

export function worktreeRetentionRunMessage(
  response: RunWorktreeRetentionResponse,
): string {
  if (response.alreadyRunning) {
    return "Cleanup is already running.";
  }

  if (response.failedCount > 0) {
    const detail = firstSafeRowMessage(response, "failed");
    const base = response.attemptedCount > 0
      ? `Cleanup hit ${formatCount(response.failedCount, "failure")} after attempting checkout cleanup`
      : `Cleanup could not evaluate ${formatCount(response.failedCount, "candidate")}`;
    return finishRetentionMessage(
      withOptionalDetail(base, detail),
      response,
      "failed",
    );
  }

  if (response.retiredCount > 0) {
    return finishRetentionMessage(
      `Retired ${formatCount(response.retiredCount, "checkout")}.`,
      response,
      "retired",
    );
  }

  if (response.blockedCount > 0) {
    const detail = firstSafeRowMessage(response, "blocked");
    return finishRetentionMessage(
      withOptionalDetail(
        `Cleanup found ${formatCount(response.blockedCount, "candidate")} blocked by safety checks or active operations`,
        detail,
      ),
      response,
      "blocked",
    );
  }

  if (response.skippedCount > 0) {
    const detail = firstSafeRowMessage(response, "skipped");
    return finishRetentionMessage(
      withOptionalDetail(
        `Cleanup skipped ${formatCount(response.skippedCount, "row")} that ${response.skippedCount === 1 ? "was" : "were"} not eligible for retention`,
        detail,
      ),
      response,
      "skipped",
    );
  }

  if (response.consideredCount === 0 && response.rows.length === 0) {
    return finishRetentionMessage(
      "No checkouts are over the retention limit.",
      response,
      null,
    );
  }

  return finishRetentionMessage(
    "Worktree cleanup finished.",
    response,
    null,
  );
}

function finishRetentionMessage(
  base: string,
  response: RunWorktreeRetentionResponse,
  primaryOutcome: WorktreeRetentionRowOutcome | null,
): string {
  const details = retentionOutcomeDetails(response, primaryOutcome);
  const remaining = response.moreEligibleRemaining
    ? ["Run cleanup again to continue."]
    : [];
  return [base, ...details, ...remaining].join(" ");
}

function retentionOutcomeDetails(
  response: RunWorktreeRetentionResponse,
  primaryOutcome: WorktreeRetentionRowOutcome | null,
): string[] {
  const details: string[] = [];
  const outcomes: Array<[WorktreeRetentionRowOutcome, number, string]> = [
    ["retired", response.retiredCount, "retired"],
    ["blocked", response.blockedCount, "blocked"],
    ["skipped", response.skippedCount, "skipped"],
    ["failed", response.failedCount, "failed"],
  ];
  for (const [outcome, count, label] of outcomes) {
    if (outcome === primaryOutcome || count === 0) {
      continue;
    }
    details.push(`${count} ${label}`);
  }
  return details.length > 0 ? [`${details.join("; ")}.`] : [];
}

function firstSafeRowMessage(
  response: RunWorktreeRetentionResponse,
  outcome: WorktreeRetentionRowOutcome,
): string | null {
  const row = response.rows.find((candidate) => candidate.outcome === outcome);
  return safeRowMessage(row?.message);
}

function safeRowMessage(message: string | undefined): string | null {
  const trimmed = message?.trim() ?? "";
  if (trimmed.length === 0 || trimmed.length > 140) {
    return null;
  }
  if (/[\\/]/.test(trimmed) || /(^|\s)~($|\s|\/)/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function withOptionalDetail(base: string, detail: string | null): string {
  return detail ? `${base}: ${detail}.` : `${base}.`;
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
