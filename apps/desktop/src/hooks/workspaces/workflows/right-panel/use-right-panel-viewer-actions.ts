import {
  useCallback,
  type SetStateAction,
} from "react";
import {
  type RightPanelHeaderEntryKey,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  removeViewerTargetFromRightPanelState,
  resolveViewerTargetKeyAfterHeaderEntryRemoval,
} from "@/lib/domain/workspaces/shell/right-panel-state";
import {
  viewerTargetEditablePath,
  viewerTargetKey,
  type ViewerTarget,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import type { WorkspaceFileBuffer } from "@/stores/editor/workspace-file-buffers-store";

type RightPanelStateUpdater = (value: SetStateAction<RightPanelWorkspaceState>) => void;

interface UseRightPanelViewerActionsOptions {
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
  state,
  isCloudWorkspaceSelected,
  openViewerTargets,
  buffersByPath,
  updateState,
  closeViewerTarget,
  setActiveViewerTarget,
  clearBuffer,
}: UseRightPanelViewerActionsOptions) {
  const selectViewer = useCallback((targetKey: RightPanelHeaderEntryKey) => {
    const target = openViewerTargets.find((candidate) =>
      viewerTargetKey(candidate) === targetKey
    );
    if (!target || target.kind === "allChanges") {
      return;
    }
    setActiveViewerTarget(targetKey as ViewerTargetKey);
    updateState((previous) => ({
      ...previous,
      activeEntryKey: targetKey,
      headerOrder: previous.headerOrder.includes(targetKey)
        ? previous.headerOrder
        : [...previous.headerOrder, targetKey],
    }));
  }, [openViewerTargets, setActiveViewerTarget, updateState]);

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
