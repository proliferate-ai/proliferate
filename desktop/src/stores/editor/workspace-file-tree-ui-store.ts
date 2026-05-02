import { create } from "zustand";

interface WorkspaceFileTreeUiState {
  expandedDirectoriesByTreeKey: Record<string, Record<string, true>>;
  selectedDirectoryByTreeKey: Record<string, string>;
  createDraftByTreeKey: Record<string, { kind: "file" | "directory"; parentPath: string } | undefined>;
  expandDirectory: (treeKey: string, dirPath: string) => void;
  collapseDirectory: (treeKey: string, dirPath: string) => void;
  removeExpandedDirectory: (treeKey: string, dirPath: string) => void;
  collapseAllDirectories: (treeKey: string) => void;
  setSelectedDirectory: (treeKey: string, dirPath: string) => void;
  startCreateDraft: (
    treeKey: string,
    draft: { kind: "file" | "directory"; parentPath: string },
  ) => void;
  clearCreateDraft: (treeKey: string) => void;
}

export const useWorkspaceFileTreeUiStore = create<WorkspaceFileTreeUiState>((set) => ({
  expandedDirectoriesByTreeKey: {},
  selectedDirectoryByTreeKey: {},
  createDraftByTreeKey: {},

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

  collapseAllDirectories: (treeKey) => {
    set((current) => {
      if (!current.expandedDirectoriesByTreeKey[treeKey]) {
        return current;
      }
      const nextExpandedDirectoriesByTreeKey = { ...current.expandedDirectoriesByTreeKey };
      delete nextExpandedDirectoriesByTreeKey[treeKey];
      return { expandedDirectoriesByTreeKey: nextExpandedDirectoriesByTreeKey };
    });
  },

  setSelectedDirectory: (treeKey, dirPath) => {
    set((current) => ({
      selectedDirectoryByTreeKey: {
        ...current.selectedDirectoryByTreeKey,
        [treeKey]: dirPath,
      },
    }));
  },

  startCreateDraft: (treeKey, draft) => {
    set((current) => ({
      createDraftByTreeKey: {
        ...current.createDraftByTreeKey,
        [treeKey]: draft,
      },
      selectedDirectoryByTreeKey: {
        ...current.selectedDirectoryByTreeKey,
        [treeKey]: draft.parentPath,
      },
    }));
  },

  clearCreateDraft: (treeKey) => {
    set((current) => {
      if (!current.createDraftByTreeKey[treeKey]) {
        return current;
      }
      const next = { ...current.createDraftByTreeKey };
      delete next[treeKey];
      return { createDraftByTreeKey: next };
    });
  },
}));
