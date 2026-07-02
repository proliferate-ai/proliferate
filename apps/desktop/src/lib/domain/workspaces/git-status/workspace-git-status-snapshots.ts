import type { BranchPullRequestStatus, BranchPullRequestSummary } from "@anyharness/sdk";
import {
  isTimestampNewer,
  normalizeBranch,
  prStateFromSummary,
  snapshotSpeaksForBranch,
  type PersistedWorkspaceGitStatusSnapshot,
  type WorkspaceGitStatus,
} from "./workspace-git-status-model";

// Persisted snapshot write planning: computes the compact per-logical-
// workspace snapshots that back instant paint on relaunch. Read-side
// composition lives in workspace-git-status-model.ts.

export interface PlanGitStatusSnapshotWriteInput {
  previous: PersistedWorkspaceGitStatusSnapshot | null;
  branch: string | null;
  /**
   * Live PR entry for this branch; only consulted when `prRecordable`.
   * null = branch queried with no PR (authoritative none).
   */
  prEntry: BranchPullRequestStatus | null;
  /**
   * True only when the repo root's availability === "ok" AND the branch
   * appeared in the fetched entries. Unavailability never destroys the
   * cache it exists to back.
   */
  prRecordable: boolean;
  prFetchedAt: string | null;
  now?: string;
}

/**
 * Computes the next persisted snapshot, or null when nothing material
 * changed (timestamp-only refreshes are never persisted).
 */
export function planGitStatusSnapshotWrite(
  input: PlanGitStatusSnapshotWriteInput,
): PersistedWorkspaceGitStatusSnapshot | null {
  const branch = normalizeBranch(input.branch);
  const previous = input.previous;

  // Monotonic gate: never record from data older than the stored snapshot.
  const monotonicOk = !previous
    || !previous.capturedAt
    || !input.prFetchedAt
    || !isTimestampNewer(previous.capturedAt, input.prFetchedAt);

  const recordPr = input.prRecordable && monotonicOk;

  // Preserved PR fields only speak for the branch they were captured on.
  const previousSpeaksForBranch = previous !== null
    && snapshotSpeaksForBranch(previous, branch);

  const next: PersistedWorkspaceGitStatusSnapshot = recordPr
    ? {
      branch,
      prState: input.prEntry?.pullRequest
        ? prStateFromSummary(input.prEntry.pullRequest)
        : "none",
      prNumber: input.prEntry?.pullRequest?.number ?? null,
      prUrl: input.prEntry?.pullRequest?.url ?? null,
      checks: input.prEntry?.pullRequest?.checks ?? "none",
      reviewDecision: input.prEntry?.pullRequest?.reviewDecision ?? "none",
      capturedAt: input.prFetchedAt ?? input.now ?? new Date().toISOString(),
      lastPromptAt: previous?.lastPromptAt ?? null,
    }
    : {
      branch,
      prState: previousSpeaksForBranch ? previous.prState : null,
      prNumber: previousSpeaksForBranch ? previous.prNumber : null,
      prUrl: previousSpeaksForBranch ? previous.prUrl : null,
      checks: previousSpeaksForBranch ? previous.checks : "none",
      reviewDecision: previousSpeaksForBranch ? previous.reviewDecision : "none",
      capturedAt: previous?.capturedAt ?? input.now ?? new Date().toISOString(),
      lastPromptAt: previous?.lastPromptAt ?? null,
    };

  // A snapshot is only worth creating once PR data was actually available;
  // branch identity alone is always live from the runtime.
  if (!previous && !recordPr) {
    return null;
  }

  if (previous && gitStatusSnapshotsMateriallyEqual(previous, next)) {
    return null;
  }
  return next;
}

/** Material fields: branch|prState|prNumber|prUrl|checks|reviewDecision|lastPromptAt. */
export function gitStatusSnapshotsMateriallyEqual(
  a: PersistedWorkspaceGitStatusSnapshot,
  b: PersistedWorkspaceGitStatusSnapshot,
): boolean {
  return a.branch === b.branch
    && a.prState === b.prState
    && a.prNumber === b.prNumber
    && a.prUrl === b.prUrl
    && a.checks === b.checks
    && a.reviewDecision === b.reviewDecision
    && a.lastPromptAt === b.lastPromptAt;
}

/**
 * Snapshot upsert for a just-created PR (publish success): the daemon cache
 * was upserted server-side; this persists the created PR's identity so it
 * never flaps while polls catch up (monotonic guard protects it).
 */
export function persistedSnapshotFromPullRequestSummary(input: {
  summary: BranchPullRequestSummary;
  previous: PersistedWorkspaceGitStatusSnapshot | null;
  capturedAt: string;
}): PersistedWorkspaceGitStatusSnapshot {
  return {
    branch: input.summary.headBranch,
    prState: prStateFromSummary(input.summary),
    prNumber: input.summary.number,
    prUrl: input.summary.url,
    checks: input.summary.checks ?? "none",
    reviewDecision: input.summary.reviewDecision ?? "none",
    capturedAt: input.capturedAt,
    lastPromptAt: input.previous?.lastPromptAt ?? null,
  };
}

/**
 * Snapshot capture used at message send: current composed status, with
 * unknown PR data preserving the previous snapshot's PR fields.
 */
export function persistedSnapshotFromStatus(input: {
  status: WorkspaceGitStatus;
  previous: PersistedWorkspaceGitStatusSnapshot | null;
  lastPromptAt: string;
}): PersistedWorkspaceGitStatusSnapshot {
  const { status, previous } = input;
  const previousSpeaksForBranch = previous !== null
    && snapshotSpeaksForBranch(previous, status.branch);
  if (status.pr === null) {
    return {
      branch: status.branch,
      prState: previousSpeaksForBranch ? previous.prState : null,
      prNumber: previousSpeaksForBranch ? previous.prNumber : null,
      prUrl: previousSpeaksForBranch ? previous.prUrl : null,
      checks: previousSpeaksForBranch ? previous.checks : "none",
      reviewDecision: previousSpeaksForBranch ? previous.reviewDecision : "none",
      capturedAt: previous?.capturedAt ?? status.capturedAt,
      lastPromptAt: input.lastPromptAt,
    };
  }
  return {
    branch: status.branch,
    prState: status.pr.state,
    prNumber: status.pr.number,
    prUrl: status.pr.url,
    checks: status.pr.checks,
    reviewDecision: status.pr.reviewDecision,
    capturedAt: status.capturedAt,
    lastPromptAt: input.lastPromptAt,
  };
}
