import type {
  PersistedWorkspaceGitStatusSnapshot,
  WorkspacePrChecks,
  WorkspacePrReviewDecision,
  WorkspacePrState,
} from "@/lib/domain/workspaces/git-status/workspace-git-status-model";

export const MAX_PERSISTED_GIT_STATUS_SNAPSHOTS = 200;

const PR_STATES: readonly WorkspacePrState[] = ["none", "open", "draft", "merged", "closed"];
const PR_CHECKS: readonly WorkspacePrChecks[] = ["none", "pending", "passing", "failing"];
const PR_REVIEW_DECISIONS: readonly WorkspacePrReviewDecision[] = [
  "none",
  "approved",
  "changes_requested",
];

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function sanitizeGitStatusSnapshot(value: unknown): PersistedWorkspaceGitStatusSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<Record<keyof PersistedWorkspaceGitStatusSnapshot, unknown>>;
  if (!isNullableString(candidate.branch ?? null)) {
    return null;
  }
  const prState = candidate.prState ?? null;
  if (prState !== null && !PR_STATES.includes(prState as WorkspacePrState)) {
    return null;
  }
  const prNumber = candidate.prNumber ?? null;
  if (prNumber !== null && (typeof prNumber !== "number" || !Number.isFinite(prNumber))) {
    return null;
  }
  if (!isNullableString(candidate.prUrl ?? null)) {
    return null;
  }
  if (!PR_CHECKS.includes(candidate.checks as WorkspacePrChecks)) {
    return null;
  }
  if (!PR_REVIEW_DECISIONS.includes(candidate.reviewDecision as WorkspacePrReviewDecision)) {
    return null;
  }
  if (!isValidTimestamp(candidate.capturedAt)) {
    return null;
  }
  const lastPromptAt = candidate.lastPromptAt ?? null;
  if (lastPromptAt !== null && !isValidTimestamp(lastPromptAt)) {
    return null;
  }
  return {
    branch: (candidate.branch ?? null) as string | null,
    prState: prState as WorkspacePrState | null,
    prNumber: prNumber as number | null,
    prUrl: (candidate.prUrl ?? null) as string | null,
    checks: candidate.checks as WorkspacePrChecks,
    reviewDecision: candidate.reviewDecision as WorkspacePrReviewDecision,
    capturedAt: candidate.capturedAt,
    lastPromptAt: lastPromptAt as string | null,
  };
}

export function sanitizeGitStatusSnapshotsByWorkspace(
  value: unknown,
): Record<string, PersistedWorkspaceGitStatusSnapshot> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries: Array<[string, PersistedWorkspaceGitStatusSnapshot]> = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key) {
      continue;
    }
    const snapshot = sanitizeGitStatusSnapshot(raw);
    if (snapshot) {
      entries.push([key, snapshot]);
    }
  }

  entries.sort(
    ([, left], [, right]) =>
      new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime(),
  );

  return Object.fromEntries(entries.slice(0, MAX_PERSISTED_GIT_STATUS_SNAPSHOTS));
}
