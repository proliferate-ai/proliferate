import { useReadWorkspaceFileQuery } from "@anyharness/sdk-react";
import {
  useWorkspaceFileContext,
  type WorkspaceFileContext,
} from "@/hooks/workspaces/derived/files/use-workspace-file-context";
import { useWorkspaceFileBufferActions } from "@/hooks/workspaces/workflows/files/use-workspace-file-buffer-actions";
import { useWorkspaceFileInitializationActions } from "@/hooks/workspaces/workflows/files/use-workspace-file-initialization-actions";
import { useWorkspaceFileTargetActions } from "@/hooks/workspaces/workflows/files/use-workspace-file-target-actions";

export function useWorkspaceFileActions(inputContext?: WorkspaceFileContext) {
  const derivedContext = useWorkspaceFileContext();
  const fileContext = inputContext ?? derivedContext;
  const initializationActions = useWorkspaceFileInitializationActions(fileContext);
  const targetActions = useWorkspaceFileTargetActions(fileContext);
  const bufferActions = useWorkspaceFileBufferActions(fileContext);

  return {
    ...initializationActions,
    ...targetActions,
    ...bufferActions,
  };
}

export { useReadWorkspaceFileQuery };
