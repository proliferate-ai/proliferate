import { useEffect } from "react";
import { useWorkspaceGitStatuses } from "@/hooks/workspaces/derived/use-workspace-git-statuses";
import { planGitStatusSnapshotWrite } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

// Owns persisting compact git/PR status snapshots into the workspace-ui
// preferences store so rows paint instantly on relaunch. Mounted once in the
// shell. Rules, in order:
// 1. Hydration + load gate: nothing happens until the workspace-ui store is
//    hydrated AND the collections query succeeded (no startup wipe).
// 2. Availability gate: PR fields are recorded only when the repo root's
//    availability === "ok" AND the branch appeared in the fetched entries;
//    otherwise the existing snapshot's PR fields are preserved (branch may
//    still update).
// 3. Monotonic gate: never record from data older than the stored snapshot.
// 4. Material-change gate: timestamp-only refreshes are not persisted.
export function useWorkspaceGitStatusPersistence(): void {
  const { statusesByLogicalId, syncByLogicalId, collectionsReady } = useWorkspaceGitStatuses();
  const hydrated = useWorkspaceUiStore((state) => state._hydrated);

  useEffect(() => {
    if (!hydrated || !collectionsReady) {
      return;
    }
    const store = useWorkspaceUiStore.getState();
    const snapshots = store.gitStatusSnapshotByWorkspace;

    for (const [logicalWorkspaceId, sync] of Object.entries(syncByLogicalId)) {
      const status = statusesByLogicalId[logicalWorkspaceId];
      if (!status) {
        continue;
      }
      const next = planGitStatusSnapshotWrite({
        previous: snapshots[logicalWorkspaceId] ?? null,
        branch: status.branch,
        prEntry: sync.prEntry,
        prRecordable: sync.branchQueried,
        prFetchedAt: sync.fetchedAt,
      });
      if (next) {
        store.recordWorkspaceGitStatusSnapshot(logicalWorkspaceId, next);
      }
    }

    // Prune only removes ids absent from a successfully loaded collection.
    store.pruneWorkspaceGitStatusSnapshots(Object.keys(syncByLogicalId));
  }, [collectionsReady, hydrated, statusesByLogicalId, syncByLogicalId]);
}
