import type { WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";

export function withRequiredWorkspaceMobilitySourceMetadata(
  preflight: WorkspaceMobilityPreflightResponse,
  fallbackBranch: string,
): WorkspaceMobilityPreflightResponse {
  const blockers = [...(preflight.blockers ?? [])];
  if (!preflight.branchName?.trim()) {
    blockers.push({
      code: "missing_branch_name",
      message: "Workspace mobility requires a resolved branch name.",
      sessionId: undefined,
    });
  }
  if (!preflight.baseCommitSha?.trim()) {
    blockers.push({
      code: "missing_base_commit_sha",
      message: "Workspace mobility requires a resolved base commit.",
      sessionId: undefined,
    });
  }

  return {
    ...preflight,
    branchName: preflight.branchName?.trim() || fallbackBranch,
    blockers,
    canMove: preflight.canMove && blockers.length === 0,
  };
}

export function isWorkspaceMobilityConfirmSnapshotReadyToMove(
  snapshot: WorkspaceMobilityConfirmSnapshot | null,
): snapshot is WorkspaceMobilityConfirmSnapshot {
  return Boolean(
    snapshot
    && snapshot.sourcePreflight.canMove
    && snapshot.cloudPreflight.canStart
    && (snapshot.sourcePreflight.blockers?.length ?? 0) === 0
    && (snapshot.cloudPreflight.blockers?.length ?? 0) === 0,
  );
}
