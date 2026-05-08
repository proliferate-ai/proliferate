import { useCallback } from "react";
import { useWorkspaceFilesCache } from "@/hooks/access/anyharness/files/use-workspace-files-cache";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

export function useWorkspaceFilesRefresh(args: {
  refetchChanges: () => Promise<unknown>;
}) {
  const { refetchChanges } = args;
  const materializedWorkspaceId = useWorkspaceViewerTabsStore((s) => s.materializedWorkspaceId);
  const runtimeUrl = useWorkspaceViewerTabsStore((s) => s.runtimeUrl);
  const { invalidateWorkspaceFiles } = useWorkspaceFilesCache();

  const refreshFiles = useCallback(() => {
    if (!runtimeUrl || !materializedWorkspaceId) {
      return;
    }

    void Promise.all([
      invalidateWorkspaceFiles({
        runtimeUrl,
        workspaceId: materializedWorkspaceId,
      }),
      refetchChanges(),
    ]);
  }, [
    invalidateWorkspaceFiles,
    materializedWorkspaceId,
    refetchChanges,
    runtimeUrl,
  ]);

  return {
    refreshFiles,
  };
}
