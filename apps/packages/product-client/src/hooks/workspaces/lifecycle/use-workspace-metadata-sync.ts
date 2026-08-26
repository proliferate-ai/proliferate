import { useGitStatusQuery } from "@anyharness/sdk-react";
import { useIsHotPaintGatePendingForWorkspace } from "#product/hooks/workspaces/derived/use-hot-paint-gate";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

// Owns mounted metadata synchronization for the selected workspace.
// Display state and user-triggered workspace actions live in sibling hook
// folders. The tight cloud-workspace git-status poll and the cloud
// display-name backfill died with the cloud sandbox stack — the local
// runtime's own git status query is the whole surface now.
export function useWorkspaceMetadataSync() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);

  return useGitStatusQuery({
    enabled: !!selectedWorkspaceId && !hotPaintPending,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}
