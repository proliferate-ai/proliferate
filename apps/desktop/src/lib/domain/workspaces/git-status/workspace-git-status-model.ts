import type { BranchPullRequestStatus, BranchPullRequestSummary } from "@anyharness/sdk";

export type WorkspacePrState = "none" | "open" | "draft" | "merged" | "closed";
export type WorkspacePrChecks = "none" | "pending" | "passing" | "failing";
export type WorkspacePrReviewDecision = "none" | "approved" | "changes_requested";
export type WorkspaceGitAttention = "conflicts" | "ci_failing" | "changes_requested" | "none";

// Availability of the per-repo-root PR status feed. Anything except "ok"
// means PR data is UNKNOWN (never conflated with an authoritative
// state:"none").
export type WorkspacePrStatusAvailability =
  | "ok"
  | "gh_not_installed"
  | "gh_auth_required"
  | "remote_unsupported"
  | "endpoint_missing"
  | "error";

export interface WorkspacePrStatus {
  /** "none" = this branch was QUERIED and has no PR (authoritative). */
  state: WorkspacePrState;
  number: number | null;
  url: string | null;
  checks: WorkspacePrChecks;
  reviewDecision: WorkspacePrReviewDecision;
}

export interface WorkspaceGitStatus {
  /** Workspace.currentBranch (authoritative). */
  branch: string | null;
  /** null = unknown (no inventory row matched). */
  dirty: boolean | null;
  conflicted: boolean | null;
  ahead: number | null;
  behind: number | null;
  hasUpstream: boolean | null;
  /**
   * null = PR data UNKNOWN/unavailable (gh missing/unauthed/error/
   * not-yet-fetched/branch-not-queried) — NEVER conflated with state:"none".
   */
  pr: WorkspacePrStatus | null;
  attention: WorkspaceGitAttention;
  /** fetchedAt of the freshest payload that produced this status. */
  capturedAt: string;
  source: "live" | "snapshot";
}

// Persisted, compact snapshot keyed by logical workspace id. dirty/ahead/
// behind are never persisted (cheap live, misleading stale).
export interface PersistedWorkspaceGitStatusSnapshot {
  branch: string | null;
  /** null = PR data was never available for this branch. */
  prState: WorkspacePrState | null;
  prNumber: number | null;
  prUrl: string | null;
  checks: WorkspacePrChecks;
  reviewDecision: WorkspacePrReviewDecision;
  capturedAt: string;
  lastPromptAt: string | null;
}

// Structural subset of the worktree-inventory `WorktreeGitStatusSummary`.
export interface WorkspaceWorktreeSummaryInput {
  state: "clean" | "dirty" | "conflicted" | "unknown";
  conflicted: boolean;
  ahead: number;
  behind: number;
  upstreamBranch?: string | null;
}

export interface ComposeWorkspaceGitStatusInput {
  branch: string | null;
  worktreeSummary: WorkspaceWorktreeSummaryInput | null;
  /** null/undefined = this branch was absent from the fetched entries. */
  prEntry: BranchPullRequestStatus | null;
  /** null = no PR feed exists for this workspace (e.g. no repo root). */
  prAvailability: WorkspacePrStatusAvailability | null;
  prFetchedAt: string | null;
  snapshot: PersistedWorkspaceGitStatusSnapshot | null;
  /** Injectable clock for tests; defaults to the wall clock. */
  now?: string;
}

export function deriveGitAttention(input: {
  conflicted: boolean | null;
  pr: WorkspacePrStatus | null;
}): WorkspaceGitAttention {
  if (input.conflicted === true) {
    return "conflicts";
  }
  if (input.pr?.checks === "failing") {
    return "ci_failing";
  }
  if (input.pr?.reviewDecision === "changes_requested") {
    return "changes_requested";
  }
  return "none";
}

export function pathsEqualCanonical(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return canonicalizePathForComparison(a) === canonicalizePathForComparison(b);
}

function canonicalizePathForComparison(path: string): string {
  let normalized = path.trim();
  // macOS resolves /tmp, /var, /etc through /private; inventory rows report
  // canonical (/private-prefixed) paths while workspace records may not.
  if (normalized.startsWith("/private/")) {
    normalized = normalized.slice("/private".length);
  }
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function timestampValue(value: string | null | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  return new Date(value).getTime();
}

/** True when `candidate` is strictly newer than `reference`. */
export function isTimestampNewer(
  candidate: string | null | undefined,
  reference: string | null | undefined,
): boolean {
  const candidateAt = timestampValue(candidate);
  const referenceAt = timestampValue(reference);
  if (Number.isNaN(candidateAt)) {
    return false;
  }
  if (Number.isNaN(referenceAt)) {
    return true;
  }
  return candidateAt > referenceAt;
}

function normalizeBranch(branch: string | null | undefined): string | null {
  const trimmed = branch?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function prStateFromSummary(summary: BranchPullRequestSummary): WorkspacePrState {
  if (summary.state === "open") {
    return summary.draft ? "draft" : "open";
  }
  return summary.state === "merged" ? "merged" : "closed";
}

function prStatusFromSummary(summary: BranchPullRequestSummary): WorkspacePrStatus {
  return {
    state: prStateFromSummary(summary),
    number: summary.number,
    url: summary.url,
    checks: summary.checks ?? "none",
    reviewDecision: summary.reviewDecision ?? "none",
  };
}

const AUTHORITATIVE_NO_PR: WorkspacePrStatus = {
  state: "none",
  number: null,
  url: null,
  checks: "none",
  reviewDecision: "none",
};

function prStatusFromSnapshotFields(
  snapshot: PersistedWorkspaceGitStatusSnapshot,
): WorkspacePrStatus | null {
  if (snapshot.prState === null) {
    return null;
  }
  return {
    state: snapshot.prState,
    number: snapshot.prNumber,
    url: snapshot.prUrl,
    checks: snapshot.checks,
    reviewDecision: snapshot.reviewDecision,
  };
}

// PR identity is branch-scoped: a snapshot only speaks for the branch it was
// captured on. A null runtime branch cannot prove a mismatch (same logical
// workspace), so the snapshot is kept in that case.
function snapshotSpeaksForBranch(
  snapshot: PersistedWorkspaceGitStatusSnapshot,
  branch: string | null,
): boolean {
  if (branch === null || snapshot.branch === null) {
    return true;
  }
  return snapshot.branch === branch;
}

export function composeWorkspaceGitStatus(
  input: ComposeWorkspaceGitStatusInput,
): WorkspaceGitStatus {
  const branch = normalizeBranch(input.branch);
  const summary = input.worktreeSummary;
  const summaryKnown = summary !== null && summary.state !== "unknown";
  const dirty = summaryKnown ? summary.state !== "clean" : null;
  const conflicted = summaryKnown ? summary.conflicted : null;
  const ahead = summaryKnown ? summary.ahead : null;
  const behind = summaryKnown ? summary.behind : null;
  const hasUpstream = summaryKnown
    ? Boolean(summary.upstreamBranch?.trim())
    : null;

  const snapshot = input.snapshot && snapshotSpeaksForBranch(input.snapshot, branch)
    ? input.snapshot
    : null;
  const snapshotPr = snapshot ? prStatusFromSnapshotFields(snapshot) : null;

  const liveQueried = input.prAvailability === "ok" && input.prEntry != null;

  let pr: WorkspacePrStatus | null;
  let source: "live" | "snapshot";
  let capturedAt: string;
  const fallbackCapturedAt = () => input.now ?? new Date().toISOString();

  if (liveQueried) {
    // Monotonic rule: an older fetch never overwrites a newer snapshot.
    if (snapshot && isTimestampNewer(snapshot.capturedAt, input.prFetchedAt)) {
      pr = snapshotPr;
      source = "snapshot";
      capturedAt = snapshot.capturedAt;
    } else {
      pr = input.prEntry?.pullRequest
        ? prStatusFromSummary(input.prEntry.pullRequest)
        : AUTHORITATIVE_NO_PR;
      source = "live";
      capturedAt = input.prFetchedAt ?? fallbackCapturedAt();
    }
  } else if (snapshot) {
    // PR data unknown (unavailable, branch not queried, not yet fetched):
    // keep the snapshot's PR fields.
    pr = snapshotPr;
    source = "snapshot";
    capturedAt = snapshot.capturedAt;
  } else {
    pr = null;
    source = "live";
    capturedAt = input.prFetchedAt ?? fallbackCapturedAt();
  }

  return {
    branch,
    dirty,
    conflicted,
    ahead,
    behind,
    hasUpstream,
    pr,
    attention: deriveGitAttention({ conflicted, pr }),
    capturedAt,
    source,
  };
}

export function gitStatusFromSnapshot(
  snapshot: PersistedWorkspaceGitStatusSnapshot,
  currentBranch: string | null,
): WorkspaceGitStatus {
  const branch = normalizeBranch(currentBranch) ?? snapshot.branch;
  const pr = snapshotSpeaksForBranch(snapshot, normalizeBranch(currentBranch))
    ? prStatusFromSnapshotFields(snapshot)
    : null;
  return {
    branch,
    dirty: null,
    conflicted: null,
    ahead: null,
    behind: null,
    hasUpstream: null,
    pr,
    attention: deriveGitAttention({ conflicted: null, pr }),
    capturedAt: snapshot.capturedAt,
    source: "snapshot",
  };
}

function workspacePrStatusesEqual(
  a: WorkspacePrStatus | null,
  b: WorkspacePrStatus | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.state === b.state
    && a.number === b.number
    && a.url === b.url
    && a.checks === b.checks
    && a.reviewDecision === b.reviewDecision;
}

/**
 * Material equality for render statuses. capturedAt is deliberately ignored
 * so timestamp-only refreshes preserve object identity (structural sharing).
 */
export function workspaceGitStatusesMateriallyEqual(
  a: WorkspaceGitStatus,
  b: WorkspaceGitStatus,
): boolean {
  return a.branch === b.branch
    && a.dirty === b.dirty
    && a.conflicted === b.conflicted
    && a.ahead === b.ahead
    && a.behind === b.behind
    && a.hasUpstream === b.hasUpstream
    && a.attention === b.attention
    && a.source === b.source
    && workspacePrStatusesEqual(a.pr, b.pr);
}

// ---------------------------------------------------------------------------
// Persisted snapshot write planning
// ---------------------------------------------------------------------------

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
