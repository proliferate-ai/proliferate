import { useCallback, useMemo } from "react";
import { useRefreshPrStatuses } from "@/hooks/workspaces/cache/use-pr-status-refresh";
import { useWorkspaceGitStatuses } from "@/hooks/workspaces/derived/use-workspace-git-statuses";
import { persistedSnapshotFromStatus } from "@/lib/domain/workspaces/git-status/workspace-git-status-snapshots";
import {
  recordWorkspaceGitStatusSnapshot,
  stampWorkspaceGitPrompt,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";

// Owns the message-send git side effects: capture the current composed git
// status into the persisted snapshot, stamp lastPromptAt, and expose the
// refresh=1 kick for the workspace's repo root.
export function useGitPromptSnapshotEffects() {
  const { statusesByLogicalId, syncByLogicalId } = useWorkspaceGitStatuses();
  const refreshPrStatuses = useRefreshPrStatuses();

  const captureGitStatusSnapshot = useCallback(
    (logicalWorkspaceId: string, at: string) => {
      const status = statusesByLogicalId[logicalWorkspaceId];
      if (!status) {
        return;
      }
      const previous = useWorkspaceUiStore.getState()
        .gitStatusSnapshotByWorkspace[logicalWorkspaceId] ?? null;
      recordWorkspaceGitStatusSnapshot(
        logicalWorkspaceId,
        persistedSnapshotFromStatus({ status, previous, lastPromptAt: at }),
      );
    },
    [statusesByLogicalId],
  );

  const repoRootIdForLogicalWorkspace = useCallback(
    (logicalWorkspaceId: string | null) => (
      logicalWorkspaceId
        ? syncByLogicalId[logicalWorkspaceId]?.repoRootId ?? null
        : null
    ),
    [syncByLogicalId],
  );

  return useMemo(() => ({
    repoRootIdForLogicalWorkspace,
    /** Git third of the prompt-submit side-effect deps, ready to spread. */
    promptSubmitDeps: {
      captureGitStatusSnapshot,
      stampGitPrompt: stampWorkspaceGitPrompt,
      refreshPrStatuses,
    },
  }), [captureGitStatusSnapshot, refreshPrStatuses, repoRootIdForLogicalWorkspace]);
}
