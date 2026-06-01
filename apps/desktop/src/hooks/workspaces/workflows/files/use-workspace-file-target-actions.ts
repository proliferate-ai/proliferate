import { useCallback } from "react";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import type { WorkspaceFileContext } from "@/hooks/workspaces/derived/files/use-workspace-file-context";
import type { GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";
import { rightPanelToolHeaderKey } from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  fileDiffViewerTarget,
  fileViewerTarget,
  type FileDiffViewerScope,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useGitPanelUiStore } from "@/stores/editor/git-panel-ui-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useWorkspaceFileTargetActions(fileContext: WorkspaceFileContext) {
  const openTarget = useWorkspaceViewerTabsStore((state) => state.openTarget);
  const setRightPanelMaterializedForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelMaterializedForWorkspace,
  );
  const setRightPanelOpenForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelOpenForWorkspace,
  );
  const requestGitPanelMode = useGitPanelUiStore((state) => state.requestModeForWorkspace);
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

  const openGitReviewPane = useCallback((options?: { mode?: GitPanelMode }) => {
    const materializedWorkspaceId = fileContext.materializedWorkspaceId;
    const workspaceUiKey = fileContext.workspaceUiKey;
    if (!materializedWorkspaceId || !workspaceUiKey) {
      return;
    }

    const gitEntryKey = rightPanelToolHeaderKey("git");
    setRightPanelMaterializedForWorkspace(materializedWorkspaceId, (previous) => ({
      ...previous,
      activeEntryKey: gitEntryKey,
      headerOrder: previous.headerOrder.includes(gitEntryKey)
        ? previous.headerOrder
        : [...previous.headerOrder, gitEntryKey],
    }));
    setRightPanelOpenForWorkspace(workspaceUiKey, true);
    if (options?.mode) {
      requestGitPanelMode(materializedWorkspaceId, options.mode);
    }
  }, [
    fileContext.materializedWorkspaceId,
    fileContext.workspaceUiKey,
    requestGitPanelMode,
    setRightPanelMaterializedForWorkspace,
    setRightPanelOpenForWorkspace,
  ]);

  return {
    openFile,
    openFileDiff,
    openGitReviewPane,
    openViewerTarget,
  };
}
