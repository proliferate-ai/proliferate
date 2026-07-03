import type { WorkspaceMobilityRuntimeMode } from "@anyharness/sdk";

// Pure re-adopt-vs-prepare-fresh decision for the cloud->local mirror's local
// destination step (spec section 2.3 step 3 / 2.4 point 2 "Re-adopt on install"). A
// workspace that was this identity's own local home before an earlier local->cloud
// move is left behind marked `remote_owned` -- never destroyed unless it was a
// managed worktree (the locked "Source fate after cutover" decision) -- so if it is
// still on disk for this (repoRoot, branch), install must **re-adopt** it in place
// rather than minting a fresh destination worktree: the engine refuses a duplicate
// checked-out branch at prepare-destination (spec section 1, "Duplicate checked-out
// branch is refused"). A destroyed managed worktree has nothing to re-adopt and
// always prepares fresh.

export interface LocalWorkspaceForBranchLookup {
  /** The desktop-facing workspace id -- for a local workspace this *is* the
   *  AnyHarness workspace id (no `cloud:`/`target:` synthetic wrapping), so it can be
   *  used directly with `resolveWorkspaceConnection` and the mobility install call. */
  workspaceId: string;
  repoRootId: string;
  currentBranch: string | null;
}

/**
 * Finds the local workspace (if any) already materialized for (repoRootId, branch) --
 * the candidate a round-trip move should re-adopt. Desktop's local workspace
 * collections don't carry mobility runtime-state (the AnyHarness `Workspace` wire
 * shape has none), so the caller still needs a live preflight/runtime-state call on
 * the match to learn its mode before calling `resolveLocalMoveDestinationPlan`.
 */
export function findLocalMoveDestinationCandidateWorkspace(
  workspaces: readonly LocalWorkspaceForBranchLookup[],
  repoRootId: string | null,
  branch: string | null,
): LocalWorkspaceForBranchLookup | null {
  if (!repoRootId || !branch) return null;
  const trimmedBranch = branch.trim();
  if (!trimmedBranch) return null;
  return workspaces.find((workspace) =>
    workspace.repoRootId === repoRootId
    && workspace.currentBranch?.trim() === trimmedBranch
  ) ?? null;
}

export interface LocalMoveDestinationCandidate {
  workspaceId: string;
  runtimeStateMode: WorkspaceMobilityRuntimeMode | null;
}

export type LocalMoveDestinationPlan =
  | { mode: "re_adopt"; workspaceId: string }
  | { mode: "prepare_fresh" };

/**
 * Pure re-adopt-vs-prepare-fresh decision. Only a candidate whose mobility
 * runtime-state is `remote_owned` (this identity's own prior local home, left behind
 * by an earlier local->cloud move) is eligible for re-adopt -- an active (`normal`)
 * workspace on the same branch is a genuine collision the caller should have already
 * kept this function from seeing, and a `frozen_for_handoff`/`repair_blocked`
 * workspace is mid-something-else and must not be adopted into.
 */
export function resolveLocalMoveDestinationPlan(
  candidate: LocalMoveDestinationCandidate | null,
): LocalMoveDestinationPlan {
  if (candidate && candidate.runtimeStateMode === "remote_owned") {
    return { mode: "re_adopt", workspaceId: candidate.workspaceId };
  }
  return { mode: "prepare_fresh" };
}
