import {
  deriveWorkspaceGitRelation,
  type WorkspaceGitRelation,
  type WorkspaceGitSide,
} from "#product/lib/domain/workspaces/cloud/workspace-git-relation";

/**
 * Flow 4 "Link copies" is association-only: it links an EXISTING local workspace
 * to a Cloud workspace when the two are provably the same checkout, and cuts NO
 * worktree. This module is the pure proof gate. It NEVER falls through to
 * materialization — a failed proof yields a truthful, typed blocker so the host
 * can explain why the two are not linkable (e.g. their HEADs differ) instead of
 * silently creating a second worktree at the Cloud HEAD (the PR5-LINK-01 bug).
 *
 * PR 6 refactor: the proof is no longer a parallel model. The link gate is now
 * exactly `deriveWorkspaceGitRelation(...) === "same_head"` — the shared relation
 * resolver decides same-repo / case-sensitive branch / clean-normal / EXACT-HEAD.
 * The one gate this module keeps on top is the association-level "not already
 * linked to another active Cloud workspace" check, which is not a Git relation.
 *
 * The required proof, per the frozen Flow 4 contract:
 *  - canonical provider/owner/repo match (case-folded, .git-stripped),
 *  - case-SENSITIVE branch match (feat/X != feat/x),
 *  - both sides clean / normal (no dirty, conflicted, detached, mid-op),
 *  - EXACT HEAD match (same commit sha),
 *  - the candidate is not already linked to another active Cloud workspace.
 */

/** A local candidate's proof-relevant facts, read from the local runtime git
 * status (never inferred). `alreadyLinkedCloudWorkspaceId` is the id of another
 * active Cloud workspace this local is already the linked local copy of, or null. */
export interface LinkLocalCandidateProof {
  anyharnessWorkspaceId: string;
  provider: string;
  owner: string;
  repoName: string;
  branch: string | null;
  headSha: string | null;
  clean: boolean;
  conflicted: boolean;
  detached: boolean;
  /** True when a Git operation (merge/rebase/…) is in progress. */
  operationInProgress: boolean;
  alreadyLinkedCloudWorkspaceId: string | null;
}

/** The Cloud side's proof-relevant facts. `headSha` is the published HEAD the
 * server will re-verify; the local must equal it exactly. */
export interface LinkCloudTargetProof {
  cloudWorkspaceId: string;
  provider: string;
  owner: string;
  repoName: string;
  branch: string | null;
  headSha: string | null;
}

export type LinkVerification =
  | { linkable: true }
  | { linkable: false; blocker: string };

/** Adapt a link candidate's proof facts to a clean-comparable local Git side.
 * The candidate proof only carries linkability-relevant fields, so ahead/behind
 * are unknown here (null) — link never depends on tracking-ref counts, only on
 * an exact HEAD of two clean/normal sides. */
function candidateGitSide(candidate: LinkLocalCandidateProof): WorkspaceGitSide {
  return {
    presence: "present",
    provider: candidate.provider,
    owner: candidate.owner,
    repoName: candidate.repoName,
    branch: candidate.branch,
    headSha: candidate.headSha,
    clean: candidate.clean,
    conflicted: candidate.conflicted,
    detached: candidate.detached,
    operationInProgress: candidate.operationInProgress,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
  };
}

function targetGitSide(target: LinkCloudTargetProof): WorkspaceGitSide {
  return {
    presence: "present",
    provider: target.provider,
    owner: target.owner,
    repoName: target.repoName,
    branch: target.branch,
    headSha: target.headSha,
    clean: true,
    conflicted: false,
    detached: false,
    operationInProgress: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
  };
}

/** Map a non-same_head relation to the truthful link blocker string. Only the
 * local-side blockers are surfaced with candidate-specific copy; every other
 * verdict means the two are not the exact same commit. */
function linkBlockerForRelation(relation: WorkspaceGitRelation): string {
  switch (relation.kind) {
    case "unknown":
      // A repo mismatch or unknown status both land here.
      return relation.reason.startsWith("The two copies are different")
        ? "This local workspace is a different repository than the Cloud copy."
        : "This local workspace is at a different commit than the Cloud copy, so the two "
          + "cannot be linked without changing either checkout.";
    case "detached":
      return "This local workspace is in a detached HEAD state.";
    case "git_operation_in_progress":
      return "This local workspace has a Git operation in progress.";
    case "conflicted":
      return "This local workspace has unresolved merge conflicts.";
    case "local_dirty":
    case "cloud_dirty":
      return "This local workspace has uncommitted changes.";
    default:
      // diverged / local_ahead / cloud_ahead / behind: heads differ (branch or
      // commit), so the two are not the same checkout.
      return "This local workspace is at a different commit than the Cloud copy, so the two "
        + "cannot be linked without changing either checkout.";
  }
}

/**
 * Verify a single chosen local candidate against the Cloud target. PR 6: the
 * repo/branch/clean/exact-HEAD proof is delegated to the shared relation
 * resolver (linkable ⟺ relation.kind === "same_head"); only the association-level
 * "already linked elsewhere" check remains here. Pure so every rejection reason
 * is unit-testable away from the runtime.
 */
export function verifyLinkCandidate(
  candidate: LinkLocalCandidateProof,
  target: LinkCloudTargetProof,
): LinkVerification {
  const notLinkable = (blocker: string): LinkVerification => ({ linkable: false, blocker });

  const relation = deriveWorkspaceGitRelation({
    local: candidateGitSide(candidate),
    cloud: targetGitSide(target),
  });
  if (relation.kind !== "same_head") {
    // A case-sensitive branch mismatch is link-specific (the relation union has
    // no branch member); surface it with its own truthful message.
    if (
      candidate.branch !== null
      && target.branch !== null
      && candidate.branch !== target.branch
      && !candidate.detached
      && !candidate.conflicted
      && !candidate.operationInProgress
      && candidate.clean
    ) {
      return notLinkable("This local workspace is on a different branch than the Cloud copy.");
    }
    return notLinkable(linkBlockerForRelation(relation));
  }
  // The relation proves an exact-HEAD clean match; the remaining gate is
  // association-level, not a Git relation.
  if (
    candidate.alreadyLinkedCloudWorkspaceId !== null
    && candidate.alreadyLinkedCloudWorkspaceId !== target.cloudWorkspaceId
  ) {
    return notLinkable("This local workspace is already linked to another Cloud workspace.");
  }
  return { linkable: true };
}
