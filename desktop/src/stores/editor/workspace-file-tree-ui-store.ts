import { create } from "zustand";

interface WorkspaceFileTreeUiState {
  expandedDirectoriesByTreeKey: Record<string, Record<string, true>>;
  expandDirectory: (treeKey: string, dirPath: string) => void;
  collapseDirectory: (treeKey: string, dirPath: string) => void;
  removeExpandedDirectory: (treeKey: string, dirPath: string) => void;
}

export const useWorkspaceFileTreeUiStore = create<WorkspaceFileTreeUiState>((set) => ({
  expandedDirectoriesByTreeKey: {},

  expandDirectory: (treeKey, dirPath) => {
    set((current) => {
      if (current.expandedDirectoriesByTreeKey[treeKey]?.[dirPath]) {
        return current;
      }

      return {
        expandedDirectoriesByTreeKey: {
          ...current.expandedDirectoriesByTreeKey,
          [treeKey]: {
            ...current.expandedDirectoriesByTreeKey[treeKey],
            [dirPath]: true,
          },
        },
      };
    });
  },

  collapseDirectory: (treeKey, dirPath) => {
    set((current) => {
      const currentTreeState = current.expandedDirectoriesByTreeKey[treeKey];
      if (!currentTreeState?.[dirPath]) {
        return current;
      }

      const nextTreeState = { ...currentTreeState };
      delete nextTreeState[dirPath];

      if (Object.keys(nextTreeState).length === 0) {
        const nextExpandedDirectoriesByTreeKey = { ...current.expandedDirectoriesByTreeKey };
        delete nextExpandedDirectoriesByTreeKey[treeKey];
        return {
          expandedDirectoriesByTreeKey: nextExpandedDirectoriesByTreeKey,
        };
      }

      return {
        expandedDirectoriesByTreeKey: {
          ...current.expandedDirectoriesByTreeKey,
          [treeKey]: nextTreeState,
        },
      };
    });
  },

  removeExpandedDirectory: (treeKey, dirPath) => {
    set((current) => {
      const currentTreeState = current.expandedDirectoriesByTreeKey[treeKey];
      if (!currentTreeState?.[dirPath]) {
        return current;
      }

      const nextTreeState = { ...currentTreeState };
      delete nextTreeState[dirPath];

      if (Object.keys(nextTreeState).length === 0) {
        const nextExpandedDirectoriesByTreeKey = { ...current.expandedDirectoriesByTreeKey };
        delete nextExpandedDirectoriesByTreeKey[treeKey];
        return {
          expandedDirectoriesByTreeKey: nextExpandedDirectoriesByTreeKey,
        };
      }

      return {
        expandedDirectoriesByTreeKey: {
          ...current.expandedDirectoriesByTreeKey,
          [treeKey]: nextTreeState,
        },
      };
    });
  },
}));
