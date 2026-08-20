import { useCallback } from "react";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import type { ViewerActivationFocus } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-activation-types";
import type { WorkspaceFileContext } from "#product/hooks/workspaces/derived/files/use-workspace-file-context";
import type { GitPanelMode } from "#product/lib/domain/workspaces/changes/git-panel-diff";
import { rightPanelToolHeaderKey } from "#product/lib/domain/workspaces/shell/right-panel-model";
import {
  fileDiffViewerTarget,
  fileViewerTarget,
  type FileDiffViewerScope,
  type ViewerTarget,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useGitPanelUiStore } from "#product/stores/editor/git-panel-ui-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

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

  // External origins (chat, transcript, command palette, Changes) leave
  // `focus` unset and take the canonical `"viewer"` default; only origins that
  // own a control the user is standing on pass `"preserve-origin"`.
  const openViewerTarget = useCallback((
    target: ViewerTarget,
    options?: { focus?: ViewerActivationFocus },
  ) => {
    openTarget(target);
    if (fileContext.materializedWorkspaceId) {
      activateViewerTarget({
        workspaceId: fileContext.materializedWorkspaceId,
        shellWorkspaceId: fileContext.workspaceUiKey,
        target,
        focus: options?.focus,
      });
    }
  }, [
    activateViewerTarget,
    fileContext.materializedWorkspaceId,
    fileContext.workspaceUiKey,
    openTarget,
  ]);

  const openFile = useCallback(async (
    filePath: string,
    options?: { focus?: ViewerActivationFocus },
  ) => {
    openViewerTarget(fileViewerTarget(filePath), options);
  }, [openViewerTarget]);

  const openFileDiff = useCallback(async (filePath: string, options?: {
    scope?: FileDiffViewerScope | null;
    baseRef?: string | null;
    oldPath?: string | null;
    focus?: ViewerActivationFocus;
  }) => {
    const scope = options?.scope ?? "unstaged";
    openViewerTarget(fileDiffViewerTarget({
      path: filePath,
      scope,
      baseRef: options?.baseRef ?? null,
      oldPath: options?.oldPath ?? null,
    }), { focus: options?.focus });
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
