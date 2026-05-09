import { useCallback } from "react";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import type { WorkspaceFileContext } from "@/hooks/workspaces/files/derived/use-workspace-file-context";
import {
  fileDiffViewerTarget,
  fileViewerTarget,
  type FileDiffViewerScope,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

export function useWorkspaceFileTargetActions(fileContext: WorkspaceFileContext) {
  const openTarget = useWorkspaceViewerTabsStore((state) => state.openTarget);
  const { activateViewerTarget } = useWorkspaceShellActivation();

  const openViewerTarget = useCallback((target: ViewerTarget) => {
    openTarget(target);
    if (fileContext.materializedWorkspaceId) {
      activateViewerTarget({
        workspaceId: fileContext.materializedWorkspaceId,
        shellWorkspaceId: fileContext.workspaceUiKey,
        target,
        mode: "open-or-focus",
      });
    }
  }, [
    activateViewerTarget,
    fileContext.materializedWorkspaceId,
    fileContext.workspaceUiKey,
    openTarget,
  ]);

  const openFile = useCallback(async (filePath: string) => {
    openViewerTarget(fileViewerTarget(filePath));
  }, [openViewerTarget]);

  const openFileDiff = useCallback(async (filePath: string, options?: {
    scope?: FileDiffViewerScope | null;
    baseRef?: string | null;
    oldPath?: string | null;
  }) => {
    const scope = options?.scope ?? "unstaged";
    openViewerTarget(fileDiffViewerTarget({
      path: filePath,
      scope,
      baseRef: options?.baseRef ?? null,
      oldPath: options?.oldPath ?? null,
    }));
  }, [openViewerTarget]);

  return {
    openFile,
    openFileDiff,
    openViewerTarget,
  };
}
