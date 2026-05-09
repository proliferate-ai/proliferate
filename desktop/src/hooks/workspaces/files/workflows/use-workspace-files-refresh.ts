import { useCallback } from "react";
import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
} from "@anyharness/sdk-react";
import { useWorkspaceFilesCache } from "@/hooks/access/anyharness/files/use-workspace-files-cache";
import {
  useWorkspaceFileContext,
  type WorkspaceFileContext,
} from "@/hooks/workspaces/files/derived/use-workspace-file-context";

export function useWorkspaceFilesRefresh(args: {
  refetchChanges: () => Promise<unknown>;
  fileContext?: WorkspaceFileContext;
}) {
  const { refetchChanges } = args;
  const derivedContext = useWorkspaceFileContext();
  const fileContext = args.fileContext ?? derivedContext;
  const workspace = useAnyHarnessWorkspaceContext();
  const { invalidateWorkspaceFiles } = useWorkspaceFilesCache();

  const refreshFiles = useCallback(() => {
    if (!fileContext.materializedWorkspaceId) {
      return;
    }
    const workspaceId = fileContext.materializedWorkspaceId;

    void (async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(
        workspace,
        workspaceId,
      );
      await Promise.all([
        invalidateWorkspaceFiles({
          runtimeUrl: resolved.connection.runtimeUrl,
          workspaceId,
        }),
        refetchChanges(),
      ]);
    })().catch(() => undefined);
  }, [
    fileContext.materializedWorkspaceId,
    invalidateWorkspaceFiles,
    refetchChanges,
    workspace,
  ]);

  return {
    refreshFiles,
  };
}
