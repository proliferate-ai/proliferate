import { canonicalRepoKey } from "@proliferate/product-domain/repos/repo-id";

/**
 * Flow 4 "Link copies" is association-only: it links an EXISTING local workspace
 * to a Cloud workspace when the two are provably the same checkout, and cuts NO
 * worktree. This module is the pure proof gate. It NEVER falls through to
 * materialization — a failed proof yields a truthful, typed blocker so the host
 * can explain why the two are not linkable (e.g. their HEADs differ) instead of
 * silently creating a second worktree at the Cloud HEAD (the PR5-LINK-01 bug).
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

/**
 * Verify a single chosen local candidate against the Cloud target. Pure so the
 * proof (and every rejection reason) is unit-testable away from the runtime.
 */
export function verifyLinkCandidate(
  candidate: LinkLocalCandidateProof,
  target: LinkCloudTargetProof,
): LinkVerification {
  const notLinkable = (blocker: string): LinkVerification => ({ linkable: false, blocker });

  if (
    canonicalRepoKey(candidate.provider, candidate.owner, candidate.repoName)
    !== canonicalRepoKey(target.provider, target.owner, target.repoName)
  ) {
    return notLinkable("This local workspace is a different repository than the Cloud copy.");
  }
  if (candidate.detached || candidate.branch === null) {
    return notLinkable("This local workspace is in a detached HEAD state.");
  }
  if (candidate.operationInProgress) {
    return notLinkable("This local workspace has a Git operation in progress.");
  }
  if (candidate.conflicted) {
    return notLinkable("This local workspace has unresolved merge conflicts.");
  }
  if (!candidate.clean) {
    return notLinkable("This local workspace has uncommitted changes.");
  }
  // Case-SENSITIVE branch match: Git refs are case-sensitive, so feat/X and
  // feat/x are different branches and must not be treated as linkable.
  if (target.branch === null || candidate.branch !== target.branch) {
    return notLinkable("This local workspace is on a different branch than the Cloud copy.");
  }
  if (
    candidate.headSha === null
    || target.headSha === null
    || candidate.headSha !== target.headSha
  ) {
    return notLinkable(
      "This local workspace is at a different commit than the Cloud copy, so the two "
      + "cannot be linked without changing either checkout.",
    );
  }
  if (
    candidate.alreadyLinkedCloudWorkspaceId !== null
    && candidate.alreadyLinkedCloudWorkspaceId !== target.cloudWorkspaceId
  ) {
    return notLinkable("This local workspace is already linked to another Cloud workspace.");
  }
  return { linkable: true };
}
