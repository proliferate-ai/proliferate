import { useMemo } from "react";
import { useWorkspaceMobilityPreflightQuery } from "@/hooks/access/anyharness/mobility/use-workspace-mobility-preflight-query";
import {
  cloudWorkspaceGroupKey,
  repoRootGroupKey,
  type WorkspaceCollections,
} from "@/lib/domain/workspaces/cloud/collections";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  findLocalMoveDestinationCandidateWorkspace,
  resolveLocalMoveDestinationPlan,
  resolveLocalMoveDestinationState,
  type LocalMoveDestinationCandidate,
  type LocalMoveDestinationPlan,
} from "@/lib/domain/workspaces/move/move-destination";
import type { MoveDirection } from "@/lib/domain/workspaces/move/move-model";
import type { MoveDestinationState } from "@/lib/domain/workspaces/move/move-readiness";

export interface UseMoveDestinationPlanInput {
  direction: MoveDirection | null;
  workspaceId: string | null;
  workspaceCollections: WorkspaceCollections | undefined;
  currentBranch: string | null;
  enabled: boolean;
}

// cloud->local mirror: local destination (re-adopt-or-prepare, spec section 2.3 mirror
// step 3) -- derived purely from already-fetched collections + one extra preflight call
// on the re-adopt candidate, if any. No-ops (all null) for local_to_cloud. Split out of
// useWorkspaceMoveWorkflow as a sibling hook; `useWorkspaceMoveWorkflow` owns the wiring
// and threads the results into the saga deps and start-request builders.
export function useMoveDestinationPlan({
  direction,
  workspaceId,
  workspaceCollections,
  currentBranch,
  enabled,
}: UseMoveDestinationPlanInput) {
  const cloudWorkspaceEntry = useMemo(() => {
    if (direction !== "cloud_to_local" || !workspaceId) return null;
    const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
    if (!cloudWorkspaceId) return null;
    return workspaceCollections?.cloudWorkspaces.find((entry) => entry.id === cloudWorkspaceId) ?? null;
  }, [direction, workspaceId, workspaceCollections?.cloudWorkspaces]);

  const localRepoRoot = useMemo(() => {
    if (!cloudWorkspaceEntry) return null;
    return workspaceCollections?.repoRoots.find(
      (candidate) => repoRootGroupKey(candidate) === cloudWorkspaceGroupKey(cloudWorkspaceEntry),
    ) ?? null;
  }, [cloudWorkspaceEntry, workspaceCollections?.repoRoots]);

  const mirrorBranch = currentBranch ?? cloudWorkspaceEntry?.repo.branch ?? null;

  const destinationCandidate = useMemo(
    () => findLocalMoveDestinationCandidateWorkspace(
      (workspaceCollections?.localWorkspaces ?? []).map((workspace) => ({
        workspaceId: workspace.id,
        repoRootId: workspace.repoRootId,
        currentBranch: workspace.currentBranch ?? null,
      })),
      localRepoRoot?.id ?? null,
      mirrorBranch,
    ),
    [workspaceCollections?.localWorkspaces, localRepoRoot?.id, mirrorBranch],
  );

  const destinationCandidatePreflightQuery = useWorkspaceMobilityPreflightQuery(
    destinationCandidate?.workspaceId ?? null,
    { enabled: enabled && direction === "cloud_to_local" && destinationCandidate !== null },
  );

  const destinationCandidateWithMode: LocalMoveDestinationCandidate | null = useMemo(() => {
    if (!destinationCandidate) return null;
    return {
      workspaceId: destinationCandidate.workspaceId,
      runtimeStateMode: destinationCandidatePreflightQuery.data?.runtimeState.mode ?? null,
    };
  }, [destinationCandidate, destinationCandidatePreflightQuery.data]);

  const destinationPlan: LocalMoveDestinationPlan | null = useMemo(() => {
    if (direction !== "cloud_to_local") return null;
    if (destinationCandidate && destinationCandidatePreflightQuery.isLoading) return null;
    return resolveLocalMoveDestinationPlan(destinationCandidateWithMode);
  }, [direction, destinationCandidate, destinationCandidatePreflightQuery.isLoading, destinationCandidateWithMode]);

  const destinationState: MoveDestinationState | null = useMemo(() => {
    if (direction !== "cloud_to_local") return null;
    return resolveLocalMoveDestinationState({
      candidate: destinationCandidateWithMode,
      candidatePreflightLoading: destinationCandidatePreflightQuery.isLoading,
      hasLocalRepoRoot: localRepoRoot !== null,
    });
  }, [direction, destinationCandidateWithMode, destinationCandidatePreflightQuery.isLoading, localRepoRoot]);

  return { cloudWorkspaceEntry, localRepoRoot, destinationPlan, destinationState };
}
