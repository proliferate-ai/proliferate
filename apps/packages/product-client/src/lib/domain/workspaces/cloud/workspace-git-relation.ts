import { canonicalRepoKey } from "@proliferate/product-domain/repos/repo-id";

/**
 * PR 6 — the ONE pure cross-target Git relation resolver. It classifies a local
 * checkout and a Cloud copy of the same logical workspace into a single typed
 * relation, from which the action policy (workspace-git-reconciliation.ts)
 * derives the one safe next action. Pure and DOM-free so the exhaustive
 * relation/action matrix is unit-testable.
 *
 * Absolute safety rails encoded here:
 *  - differing exact HEADs are NEVER `same_head` (never "linked");
 *  - a side that is dirty / conflicted / detached / mid-operation blocks BEFORE
 *    any head comparison (we never reason about a moving tree);
 *  - when two heads differ and no single clean ahead/behind direction is
 *    provable client-side, the relation is `diverged` (manual resolution),
 *    never a guessed reset/rebase direction.
 *
 * Truthfulness rule (verified GAP, reconciliation §B-9/§D-14): the runtime has
 * NO live remote-HEAD probe and the client-facing branches route carries no
 * per-branch SHA, so an authoritative GitHub remote HEAD is NOT client-visible.
 * `ahead`/`behind` come from `git status`'s tracking-ref counts, i.e. only as
 * fresh as the last fetch. This resolver therefore reports `remoteHead: null`
 * ("last-known / not client-verifiable") everywhere; authoritative remote
 * verification stays server-side (existing intent-time verification). The UX
 * must label remote staleness honestly.
 */

/** Whether a target's checkout is reachable at all. */
export type WorkspaceGitSidePresence = "present" | "missing" | "unreachable";

/** One target's proof-relevant Git facts, read from a structured AnyHarness
 * `GitStatusSnapshot` (never inferred). For a Cloud copy with no live runtime to
 * query, `headSha` is the last-known observed HEAD from the materialization row
 * and `ahead`/`behind` are unknown (null). */
export interface WorkspaceGitSide {
  presence: WorkspaceGitSidePresence;
  provider: string | null;
  owner: string | null;
  repoName: string | null;
  branch: string | null;
  headSha: string | null;
  clean: boolean | null;
  conflicted: boolean | null;
  detached: boolean | null;
  /** True when a Git operation (merge/rebase/cherry-pick/revert) is in progress. */
  operationInProgress: boolean | null;
  /** Commits ahead of the tracking ref (last-known; null = unknown). */
  ahead: number | null;
  /** Commits behind the tracking ref (last-known; null = unknown). */
  behind: number | null;
  hasUpstream: boolean | null;
}

/** A single side's classification, independent of the other target. `clean` here
 * means "known clean, conflict-free, normal branch" — the only state safe to
 * compare heads from. */
export type WorkspaceGitSideState =
  | { kind: "missing" }
  | { kind: "unreachable" }
  | { kind: "unknown"; reason: string }
  | { kind: "conflicted" }
  | { kind: "operation" }
  | { kind: "detached" }
  | { kind: "dirty" }
  | { kind: "unpublished" }
  | { kind: "ahead"; commits: number }
  | { kind: "behind"; commits: number }
  | { kind: "diverged"; ahead: number; behind: number }
  | { kind: "clean" };

export type WorkspaceGitRelation =
  | { kind: "same_head"; headSha: string }
  | { kind: "local_ahead"; localHead: string; remoteHead: string | null; commits: number }
  | { kind: "cloud_ahead"; cloudHead: string; remoteHead: string | null; commits: number }
  | { kind: "local_dirty" }
  | { kind: "cloud_dirty" }
  | { kind: "conflicted"; target: "local" | "cloud" }
  | { kind: "git_operation_in_progress"; target: "local" | "cloud" }
  | { kind: "detached"; target: "local" | "cloud" }
  | { kind: "behind"; target: "local" | "cloud" }
  | { kind: "diverged"; localHead: string; cloudHead: string; remoteHead: string | null }
  | { kind: "missing"; target: "local" | "cloud" }
  | { kind: "unreachable"; target: "local" | "cloud" }
  | { kind: "unknown"; reason: string };

/**
 * Classify ONE side. Order matters: unreachable/missing first, then the blocking
 * working-tree states (conflicted → operation → detached → dirty) before any
 * ahead/behind reasoning, then publish/sync. A side with unknown counts but a
 * clean tree is `clean` (heads still compare exactly).
 */
export function classifyWorkspaceGitSide(side: WorkspaceGitSide): WorkspaceGitSideState {
  if (side.presence === "unreachable") {
    return { kind: "unreachable" };
  }
  if (side.presence === "missing") {
    return { kind: "missing" };
  }
  if (side.clean === null || side.conflicted === null) {
    return { kind: "unknown", reason: "Git status is not available yet." };
  }
  if (side.conflicted === true) {
    return { kind: "conflicted" };
  }
  if (side.operationInProgress === true) {
    return { kind: "operation" };
  }
  if (side.detached === true || side.branch === null) {
    return { kind: "detached" };
  }
  if (side.clean === false) {
    return { kind: "dirty" };
  }
  if (side.hasUpstream === false) {
    return { kind: "unpublished" };
  }
  const ahead = side.ahead ?? 0;
  const behind = side.behind ?? 0;
  if (ahead > 0 && behind > 0) {
    return { kind: "diverged", ahead, behind };
  }
  if (ahead > 0) {
    return { kind: "ahead", commits: ahead };
  }
  if (behind > 0) {
    return { kind: "behind", commits: behind };
  }
  return { kind: "clean" };
}

function sidesShareRepo(local: WorkspaceGitSide, cloud: WorkspaceGitSide): boolean {
  if (!local.provider || !local.owner || !local.repoName) {
    return true; // Identity unknown on one side: don't manufacture a mismatch.
  }
  if (!cloud.provider || !cloud.owner || !cloud.repoName) {
    return true;
  }
  return (
    canonicalRepoKey(local.provider, local.owner, local.repoName)
    === canonicalRepoKey(cloud.provider, cloud.owner, cloud.repoName)
  );
}

/**
 * Resolve the cross-target relation between the local checkout and the Cloud
 * copy of the same logical workspace. Pure. Branch names are case-sensitive and
 * commit SHAs are exact.
 */
export function deriveWorkspaceGitRelation(input: {
  local: WorkspaceGitSide;
  cloud: WorkspaceGitSide;
}): WorkspaceGitRelation {
  const { local, cloud } = input;
  const localState = classifyWorkspaceGitSide(local);
  const cloudState = classifyWorkspaceGitSide(cloud);

  // Unreachable/missing surface first (association is preserved by the action
  // policy, never mutated here).
  if (localState.kind === "unreachable") {
    return { kind: "unreachable", target: "local" };
  }
  if (cloudState.kind === "unreachable") {
    return { kind: "unreachable", target: "cloud" };
  }
  if (localState.kind === "missing") {
    return { kind: "missing", target: "local" };
  }
  if (cloudState.kind === "missing") {
    return { kind: "missing", target: "cloud" };
  }

  // A different repository on the two sides is a hard unknown: never compare.
  if (!sidesShareRepo(local, cloud)) {
    return { kind: "unknown", reason: "The two copies are different repositories." };
  }

  // Blocking working-tree states, local before cloud, in severity order.
  const blocking = firstBlockingRelation(localState, "local")
    ?? firstBlockingRelation(cloudState, "cloud");
  if (blocking) {
    return blocking;
  }

  // Both sides are clean/normal from here. A case-sensitive branch mismatch is
  // never "linked": it is diverged work on separate branches.
  const branchMismatch = local.branch !== null
    && cloud.branch !== null
    && local.branch !== cloud.branch;

  // Exact-HEAD equality is the ONLY "linked" verdict.
  if (
    !branchMismatch
    && local.headSha !== null
    && cloud.headSha !== null
    && local.headSha === cloud.headSha
  ) {
    return { kind: "same_head", headSha: local.headSha };
  }

  // Heads differ (or are unknowable). A single clean ahead/behind direction vs
  // the tracking ref is a push/update candidate; anything else is diverged. We
  // never report a live remoteHead (not client-verifiable — §B-9/§D-14).
  if (localState.kind === "diverged" || cloudState.kind === "diverged") {
    return divergedRelation(local, cloud);
  }
  if (localState.kind === "ahead" && cloudState.kind !== "ahead") {
    if (local.headSha === null) {
      return divergedRelation(local, cloud);
    }
    return {
      kind: "local_ahead",
      localHead: local.headSha,
      remoteHead: null,
      commits: localState.commits,
    };
  }
  if (cloudState.kind === "ahead" && localState.kind !== "ahead") {
    if (cloud.headSha === null) {
      return divergedRelation(local, cloud);
    }
    return {
      kind: "cloud_ahead",
      cloudHead: cloud.headSha,
      remoteHead: null,
      commits: cloudState.commits,
    };
  }
  if (localState.kind === "behind" && cloudState.kind === "clean") {
    return { kind: "behind", target: "local" };
  }
  if (cloudState.kind === "behind" && localState.kind === "clean") {
    return { kind: "behind", target: "cloud" };
  }

  // Clean on both, heads differ (or a head is unknown, or a branch mismatch):
  // require manual resolution — never guess a direction.
  return divergedRelation(local, cloud);
}

function firstBlockingRelation(
  state: WorkspaceGitSideState,
  target: "local" | "cloud",
): WorkspaceGitRelation | null {
  switch (state.kind) {
    case "unknown":
      return { kind: "unknown", reason: state.reason };
    case "conflicted":
      return { kind: "conflicted", target };
    case "operation":
      return { kind: "git_operation_in_progress", target };
    case "detached":
      return { kind: "detached", target };
    case "dirty":
      return target === "local" ? { kind: "local_dirty" } : { kind: "cloud_dirty" };
    default:
      return null;
  }
}

function divergedRelation(
  local: WorkspaceGitSide,
  cloud: WorkspaceGitSide,
): WorkspaceGitRelation {
  if (local.headSha !== null && cloud.headSha !== null) {
    return {
      kind: "diverged",
      localHead: local.headSha,
      cloudHead: cloud.headSha,
      remoteHead: null,
    };
  }
  return { kind: "unknown", reason: "The two copies are at different commits." };
}
