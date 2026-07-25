import type { CreatePullRequestResponse } from "@anyharness/sdk";
import { persistedSnapshotFromPullRequestSummary } from "@/lib/domain/workspaces/git-status/workspace-git-status-snapshots";
import type { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import type { useRefreshPrStatuses } from "@/hooks/workspaces/cache/use-pr-status-refresh";
import {
  recordWorkspaceGitStatusSnapshot,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";

/**
 * Persist a newly-created PR into the local git-status snapshot cache
 * so the sidebar glyph updates immediately without waiting for a poll.
 */
export function recordCreatedPr(
  workspaceId: string | null,
  response: CreatePullRequestResponse,
  logicalWorkspaces: ReturnType<typeof useLogicalWorkspaces>["logicalWorkspaces"],
  refreshPrStatuses: ReturnType<typeof useRefreshPrStatuses>,
): void {
  if (!workspaceId || !response.pullRequest) return;
  const logicalWorkspace = logicalWorkspaces.find((entry) =>
    entry.localWorkspace?.id === workspaceId
    || entry.aliasIds?.includes(workspaceId));
  if (!logicalWorkspace) return;

  const previous = useWorkspaceUiStore.getState()
    .gitStatusSnapshotByWorkspace[logicalWorkspace.id] ?? null;
  recordWorkspaceGitStatusSnapshot(
    logicalWorkspace.id,
    persistedSnapshotFromPullRequestSummary({
      summary: response.pullRequest,
      previous,
      capturedAt: new Date().toISOString(),
    }),
  );
  const repoRootId = logicalWorkspace.repoRoot?.id
    ?? logicalWorkspace.localWorkspace?.repoRootId;
  if (repoRootId?.trim()) {
    refreshPrStatuses(repoRootId.trim());
  }
}
