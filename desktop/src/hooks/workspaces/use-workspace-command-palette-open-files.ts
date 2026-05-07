import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { splitFilePath } from "@/lib/domain/command-palette/entries";
import {
  isFileViewerTarget,
  viewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

export interface CommandPaletteOpenFileEntry {
  path: string;
  name: string;
  parent: string;
  isActive: boolean;
}

export function useWorkspaceCommandPaletteOpenFiles(
  selectedWorkspaceId: string | null,
): CommandPaletteOpenFileEntry[] {
  const fileState = useWorkspaceViewerTabsStore(useShallow((state) => ({
    materializedWorkspaceId: state.materializedWorkspaceId,
    openTargets: state.openTargets,
    activeTargetKey: state.activeTargetKey,
  })));

  return useMemo(() => {
    if (!selectedWorkspaceId || fileState.materializedWorkspaceId !== selectedWorkspaceId) {
      return [];
    }
    return fileState.openTargets.filter(isFileViewerTarget).map((target) => {
      const path = target.path;
      const display = splitFilePath(path);
      return {
        path,
        name: display.name,
        parent: display.parent,
        isActive: viewerTargetKey(target) === fileState.activeTargetKey,
      };
    });
  }, [
    fileState.activeTargetKey,
    fileState.openTargets,
    fileState.materializedWorkspaceId,
    selectedWorkspaceId,
  ]);
}
