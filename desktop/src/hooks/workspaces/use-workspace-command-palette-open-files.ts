import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { splitFilePath } from "@/lib/domain/command-palette/entries";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";

export interface CommandPaletteOpenFileEntry {
  path: string;
  name: string;
  parent: string;
  isActive: boolean;
}

export function useWorkspaceCommandPaletteOpenFiles(
  selectedWorkspaceId: string | null,
): CommandPaletteOpenFileEntry[] {
  const fileState = useWorkspaceFilesStore(useShallow((state) => ({
    workspaceId: state.workspaceId,
    openTabs: state.openTabs,
    activeFilePath: state.activeFilePath,
  })));

  return useMemo(() => {
    if (!selectedWorkspaceId || fileState.workspaceId !== selectedWorkspaceId) {
      return [];
    }
    return fileState.openTabs.map((path) => {
      const display = splitFilePath(path);
      return {
        path,
        name: display.name,
        parent: display.parent,
        isActive: path === fileState.activeFilePath,
      };
    });
  }, [fileState.activeFilePath, fileState.openTabs, fileState.workspaceId, selectedWorkspaceId]);
}
