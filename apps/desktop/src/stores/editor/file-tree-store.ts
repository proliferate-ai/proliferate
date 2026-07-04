import { create } from "zustand";

export const FILE_TREE_STORAGE_KEY = "proliferate.fileTreeOverlay.v1";

interface FileTreeState {
  width: number;
  expandedPaths: Set<string>;

  setWidth: (width: number) => void;
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  collapseAll: () => void;
}

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 280;
const MAX_WIDTH_RATIO = 0.6;

export { MIN_WIDTH as FILE_TREE_MIN_WIDTH, MAX_WIDTH_RATIO as FILE_TREE_MAX_WIDTH_RATIO };

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  width: readPersistedWidth(),
  expandedPaths: new Set<string>(),

  setWidth: (width) => {
    const clamped = Math.max(MIN_WIDTH, width);
    set({ width: clamped });
    writePersisted({ width: clamped });
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

interface PersistedData {
  width: number;
}

function readPersistedWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_WIDTH;
  }

  try {
    const raw = window.localStorage.getItem(FILE_TREE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_WIDTH;
    }

    const parsed: unknown = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === "object"
      && "width" in parsed
      && typeof parsed.width === "number"
    ) {
      return Math.max(MIN_WIDTH, parsed.width);
    }
  } catch {
    return DEFAULT_WIDTH;
  }

  return DEFAULT_WIDTH;
}

function writePersisted(data: PersistedData): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(FILE_TREE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Browser storage can be unavailable in tests, privacy modes, or SSR-like previews.
  }
}
