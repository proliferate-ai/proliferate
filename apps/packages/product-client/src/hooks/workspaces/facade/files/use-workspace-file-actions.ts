import {
  useWorkspaceFileContext,
  type WorkspaceFileContext,
} from "#product/hooks/workspaces/derived/files/use-workspace-file-context";
import { useWorkspaceFileBufferActions } from "#product/hooks/workspaces/workflows/files/use-workspace-file-buffer-actions";
import { useWorkspaceFileInitializationActions } from "#product/hooks/workspaces/workflows/files/use-workspace-file-initialization-actions";
import { useWorkspaceFileTargetActions } from "#product/hooks/workspaces/workflows/files/use-workspace-file-target-actions";

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
