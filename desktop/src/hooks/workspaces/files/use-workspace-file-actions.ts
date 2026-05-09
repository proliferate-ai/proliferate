import { useReadWorkspaceFileQuery } from "@anyharness/sdk-react";
import {
  useWorkspaceFileContext,
  type WorkspaceFileContext,
} from "@/hooks/workspaces/files/derived/use-workspace-file-context";
import { useWorkspaceFileBufferActions } from "@/hooks/workspaces/files/workflows/use-workspace-file-buffer-actions";
import { useWorkspaceFileInitializationActions } from "@/hooks/workspaces/files/workflows/use-workspace-file-initialization-actions";
import { useWorkspaceFileTargetActions } from "@/hooks/workspaces/files/workflows/use-workspace-file-target-actions";

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
