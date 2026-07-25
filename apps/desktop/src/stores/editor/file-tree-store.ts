import { create } from "zustand";

export const FILE_TREE_STORAGE_KEY = "proliferate.fileTreeOverlay.v1";

interface FileTreeState {
  width: number;
  expandedPaths: Set<string>;
  _hydrated: boolean;
  _persistenceRevision: number;

  hydrateWidth: (width: number) => void;
  setWidth: (width: number) => void;
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  collapseAll: () => void;
}

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 280;
const MAX_WIDTH_RATIO = 0.6;

export {
  DEFAULT_WIDTH as FILE_TREE_DEFAULT_WIDTH,
  MIN_WIDTH as FILE_TREE_MIN_WIDTH,
  MAX_WIDTH_RATIO as FILE_TREE_MAX_WIDTH_RATIO,
};

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  width: DEFAULT_WIDTH,
  expandedPaths: new Set<string>(),
  _hydrated: false,
  _persistenceRevision: 0,

  hydrateWidth: (width) => set({
    width: Math.max(MIN_WIDTH, width),
    _hydrated: true,
  }),

  setWidth: (width) => {
    const clamped = Math.max(MIN_WIDTH, width);
    set((state) => ({
      width: clamped,
      _persistenceRevision: state._persistenceRevision + 1,
    }));
  },

  toggleExpanded: (path) => {
    const next = new Set(get().expandedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    set({ expandedPaths: next });
  },

  setExpanded: (path, expanded) => {
    const next = new Set(get().expandedPaths);
    if (expanded) {
      next.add(path);
    } else {
      next.delete(path);
    }
    set({ expandedPaths: next });
  },

  collapseAll: () => {
    set({ expandedPaths: new Set() });
  },
}));
