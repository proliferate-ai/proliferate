import type { BranchPullRequestStatus } from "@anyharness/sdk";
import { useWorktreeInventoryQuery } from "@anyharness/sdk-react";
import { useMemo, useRef } from "react";
import { useRepoPrStatuses } from "@/hooks/workspaces/cache/use-repo-pr-statuses";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import {
  composeWorkspaceGitStatus,
  pathsEqualCanonical,
  workspaceGitStatusesMateriallyEqual,
  type WorkspaceGitStatus,
  type WorkspacePrStatusAvailability,
} from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export interface WorkspaceGitStatusSync {
  repoRootId: string | null;
  availability: WorkspacePrStatusAvailability | null;
  /** availability === "ok" AND this branch appeared in the fetched entries. */
  branchQueried: boolean;
  prEntry: BranchPullRequestStatus | null;
  fetchedAt: string | null;
}

export interface WorkspaceGitStatusesState {
  statusesByLogicalId: Record<string, WorkspaceGitStatus>;
  syncByLogicalId: Record<string, WorkspaceGitStatusSync>;
  /** Collections loaded successfully; gate for snapshot pruning. */
  collectionsReady: boolean;
}

function logicalWorkspaceBranch(workspace: LogicalWorkspace): string | null {
  const localBranch = workspace.localWorkspace?.currentBranch?.trim();
  if (localBranch) {
    return localBranch;
  }
  const cloudBranch = workspace.cloudWorkspace?.repo.branch?.trim();
  return cloudBranch && cloudBranch.length > 0 ? cloudBranch : null;
}

function logicalWorkspaceRepoRootId(workspace: LogicalWorkspace): string | null {
  const repoRootId = workspace.repoRoot?.id ?? workspace.localWorkspace?.repoRootId;
  const trimmed = repoRootId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// Read-only composition of Layer 0 (branch + worktree summaries) and Layer 1
// (per-branch PR statuses) with the persisted snapshot fallback, keyed by
// logical workspace id. Owns no writes and no effects.
export function useWorkspaceGitStatuses(): WorkspaceGitStatusesState {
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const collectionsQuery = useWorkspaces();
  const inventoryQuery = useWorktreeInventoryQuery();
  const snapshots = useWorkspaceUiStore((state) => state.gitStatusSnapshotByWorkspace);

  const repoRootIds = useMemo(() => {
    const ids = new Set<string>();
    for (const workspace of logicalWorkspaces) {
      const repoRootId = logicalWorkspaceRepoRootId(workspace);
      if (repoRootId) {
        ids.add(repoRootId);
      }
    }
    return [...ids].sort();
  }, [logicalWorkspaces]);

  const prStatuses = useRepoPrStatuses(repoRootIds);
  const inventoryRows = inventoryQuery.data?.rows;
  const collectionsReady = collectionsQuery.isSuccess;

  const previousStatusesRef = useRef<Record<string, WorkspaceGitStatus>>({});

  return useMemo(() => {
    const previousStatuses = previousStatusesRef.current;
    const statusesByLogicalId: Record<string, WorkspaceGitStatus> = {};
    const syncByLogicalId: Record<string, WorkspaceGitStatusSync> = {};
    let reusedAll = true;

    for (const workspace of logicalWorkspaces) {
      const branch = logicalWorkspaceBranch(workspace);
      const repoRootId = logicalWorkspaceRepoRootId(workspace);
      const snapshot = snapshots[workspace.id] ?? null;

      const localPath = workspace.localWorkspace?.path;
      const inventoryRow = localPath
        ? inventoryRows?.find((row) =>
          pathsEqualCanonical(row.canonicalPath ?? row.path, localPath))
        : undefined;

      const availability = repoRootId
        ? prStatuses.availabilityByRepoRootId[repoRootId] ?? null
        : null;
      const fetchedAt = repoRootId
        ? prStatuses.fetchedAtByRepoRootId[repoRootId] ?? null
        : null;
      const entries = repoRootId
        ? prStatuses.entriesByRepoRootId[repoRootId]
        : undefined;
      const prEntry = branch && entries
        ? entries.find((entry) => entry.headBranch === branch) ?? null
        : null;

      const status = composeWorkspaceGitStatus({
        branch,
        worktreeSummary: inventoryRow?.gitStatus ?? null,
        prEntry,
        prAvailability: availability,
        prFetchedAt: fetchedAt,
        snapshot,
      });

      // Structural sharing: timestamp-only recomputes reuse the previous
      // status object so 120s polls don't re-render the whole sidebar.
      const previous = previousStatuses[workspace.id];
      if (previous && workspaceGitStatusesMateriallyEqual(previous, status)) {
        statusesByLogicalId[workspace.id] = previous;
      } else {
        statusesByLogicalId[workspace.id] = status;
        reusedAll = false;
      }

      syncByLogicalId[workspace.id] = {
        repoRootId,
        availability,
        branchQueried: availability === "ok" && prEntry !== null,
        prEntry,
        fetchedAt,
      };
    }

    const statuses = reusedAll
      && Object.keys(previousStatuses).length === Object.keys(statusesByLogicalId).length
      ? previousStatuses
      : statusesByLogicalId;
    previousStatusesRef.current = statuses;

    return {
      statusesByLogicalId: statuses,
      syncByLogicalId,
      collectionsReady,
    };
  }, [collectionsReady, inventoryRows, logicalWorkspaces, prStatuses, snapshots]);
}
