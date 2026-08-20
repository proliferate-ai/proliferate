import {
  useCallback,
  type SetStateAction,
} from "react";
import {
  type RightPanelHeaderEntryKey,
  type RightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import {
  removeViewerTargetFromRightPanelState,
  resolveViewerTargetKeyAfterHeaderEntryRemoval,
} from "#product/lib/domain/workspaces/shell/right-panel-state";
import {
  viewerTargetEditablePath,
  viewerTargetKey,
  type ViewerTarget,
  type ViewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import type { WorkspaceFileBuffer } from "#product/stores/editor/workspace-file-buffers-store";
import { focusChatInput } from "#product/lib/domain/focus-zone";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";

type RightPanelStateUpdater = (value: SetStateAction<RightPanelWorkspaceState>) => void;

interface UseRightPanelViewerActionsOptions {
  workspaceId: string | null;
  shellWorkspaceId: string | null;
  state: RightPanelWorkspaceState;
  isCloudWorkspaceSelected: boolean;
  openViewerTargets: readonly ViewerTarget[];
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  updateState: RightPanelStateUpdater;
  closeViewerTarget: (targetKey: ViewerTargetKey) => void;
  setActiveViewerTarget: (targetKey: ViewerTargetKey | null) => void;
  clearBuffer: (path: string) => void;
}

export function useRightPanelViewerActions({
  workspaceId,
  shellWorkspaceId,
  state,
  isCloudWorkspaceSelected,
  openViewerTargets,
  buffersByPath,
  updateState,
  closeViewerTarget,
  setActiveViewerTarget,
  clearBuffer,
}: UseRightPanelViewerActionsOptions) {
  const { activateViewerTarget } = useWorkspaceShellActivation();

  const selectViewer = useCallback((targetKey: RightPanelHeaderEntryKey) => {
    const target = openViewerTargets.find((candidate) =>
      viewerTargetKey(candidate) === targetKey
    );
    if (!target || target.kind === "allChanges") {
      return;
    }
    if (workspaceId) {
      // Route through the canonical owner rather than selecting the target
      // directly: it dismisses any open search with restoration suppressed,
      // and `preserve-origin` keeps the clicked header entry focused.
      activateViewerTarget({
        workspaceId,
        shellWorkspaceId,
        target,
        focus: "preserve-origin",
      });
    } else {
      setActiveViewerTarget(targetKey as ViewerTargetKey);
    }
    updateState((previous) => ({
      ...previous,
      activeEntryKey: targetKey,
      headerOrder: previous.headerOrder.includes(targetKey)
        ? previous.headerOrder
        : [...previous.headerOrder, targetKey],
    }));
  }, [
    activateViewerTarget,
    openViewerTargets,
    setActiveViewerTarget,
    shellWorkspaceId,
    updateState,
    workspaceId,
  ]);

  const handleCloseViewer = useCallback((targetKey: RightPanelHeaderEntryKey) => {
    const target = openViewerTargets.find((candidate) =>
      viewerTargetKey(candidate) === targetKey
    );
    if (!target || target.kind === "allChanges") {
      return;
    }

    const editablePath = viewerTargetEditablePath(target);
    const isLastTargetForPath = editablePath
      ? !openViewerTargets.some((candidate) =>
        viewerTargetKey(candidate) !== targetKey
        && viewerTargetEditablePath(candidate) === editablePath
      )
      : false;
    const isDirty = editablePath && isLastTargetForPath
      ? buffersByPath[editablePath]?.isDirty ?? false
      : false;
    if (isDirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }

    closeViewerTarget(targetKey as ViewerTargetKey);
    if (editablePath && isLastTargetForPath) {
      clearBuffer(editablePath);
    }

    const nextActiveViewerTargetKey = resolveViewerTargetKeyAfterHeaderEntryRemoval(
      state.headerOrder,
      targetKey,
    );
    if (nextActiveViewerTargetKey) {
      setActiveViewerTarget(nextActiveViewerTargetKey);
    }
    updateState((previous) =>
      removeViewerTargetFromRightPanelState(
        previous,
        targetKey as ViewerTargetKey,
        isCloudWorkspaceSelected,
      )
    );
    if (target.kind === "promptAttachment") {
      focusChatInput();
    }
  }, [
    buffersByPath,
    clearBuffer,
    closeViewerTarget,
    isCloudWorkspaceSelected,
    openViewerTargets,
    setActiveViewerTarget,
    state.headerOrder,
    updateState,
  ]);

  return {
    selectViewer,
    handleCloseViewer,
  };
}
