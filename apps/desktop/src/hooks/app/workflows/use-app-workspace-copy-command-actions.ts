import { useCallback, useMemo } from "react";
import { useSelectedLogicalWorkspace } from "@/hooks/workspaces/derived/use-selected-logical-workspace";
import { useWorkspaceCopyActions } from "@/hooks/workspaces/workflows/use-workspace-copy-actions";
import { workspaceCopyMetadataForLogicalWorkspace } from "@/lib/domain/workspaces/workspace-copy-metadata";
import type { AppCommandActions } from "./app-command-action-types";

export type AppWorkspaceCopyCommandActions = Pick<
  AppCommandActions,
  "copyWorkspacePath" | "copyBranchName"
>;

export function useAppWorkspaceCopyCommandActions(): AppWorkspaceCopyCommandActions {
  const { selectedLogicalWorkspace } = useSelectedLogicalWorkspace();
  const { copyWorkspaceLocation, copyBranchName } = useWorkspaceCopyActions();
  const selectedWorkspaceCopyMetadata = useMemo(
    () => workspaceCopyMetadataForLogicalWorkspace(selectedLogicalWorkspace),
    [selectedLogicalWorkspace],
  );

  const copyWorkspacePathAction = useCallback(() => {
    void copyWorkspaceLocation(selectedWorkspaceCopyMetadata.workspaceLocation);
  }, [copyWorkspaceLocation, selectedWorkspaceCopyMetadata.workspaceLocation]);
  const copyBranchNameAction = useCallback(() => {
    void copyBranchName(selectedWorkspaceCopyMetadata.branchName);
  }, [copyBranchName, selectedWorkspaceCopyMetadata.branchName]);

  return useMemo<AppWorkspaceCopyCommandActions>(() => ({
    copyWorkspacePath: {
      execute: copyWorkspacePathAction,
      disabledReason: selectedWorkspaceCopyMetadata.workspaceLocation
        ? null
        : "Selected workspace has no path or repository.",
    },
    copyBranchName: {
      execute: copyBranchNameAction,
      disabledReason: selectedWorkspaceCopyMetadata.branchName
        ? null
        : "Selected workspace has no branch.",
    },
  }), [
    copyBranchNameAction,
    copyWorkspacePathAction,
    selectedWorkspaceCopyMetadata.branchName,
    selectedWorkspaceCopyMetadata.workspaceLocation,
  ]);
}
