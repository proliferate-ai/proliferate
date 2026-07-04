import { create } from "zustand";

export const FILE_TREE_SIDEBAR_STORAGE_KEY = "proliferate.fileTreeSidebar.v1";

interface FileTreeSidebarState {
  width: number;
  collapsed: boolean;
  expandedPaths: Set<string>;

  setWidth: (width: number) => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  collapseAll: () => void;
}

const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 160;
const MAX_WIDTH_RATIO = 0.6;

export { MIN_WIDTH as FILE_TREE_MIN_WIDTH, MAX_WIDTH_RATIO as FILE_TREE_MAX_WIDTH_RATIO };

export const useFileTreeSidebarStore = create<FileTreeSidebarState>((set, get) => ({
  width: readPersistedWidth(),
  collapsed: readPersistedCollapsed(),
  expandedPaths: new Set<string>(),

  setWidth: (width) => {
    const clamped = Math.max(MIN_WIDTH, width);
    set({ width: clamped });
    writePersisted({ width: clamped, collapsed: get().collapsed });
  },

  setCollapsed: (collapsed) => {
    set({ collapsed });
    writePersisted({ width: get().width, collapsed });
  },

  toggleCollapsed: () => {
    const collapsed = !get().collapsed;
    set({ collapsed });
    writePersisted({ width: get().width, collapsed });
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
  collapsed: boolean;
}

function readPersistedWidth(): number {
  const data = readPersisted();
  return data?.width ?? DEFAULT_WIDTH;
}

function readPersistedCollapsed(): boolean {
  const data = readPersisted();
  return data?.collapsed ?? false;
}

function readPersisted(): PersistedData | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(FILE_TREE_SIDEBAR_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === "object"
      && "width" in parsed
      && typeof parsed.width === "number"
      && "collapsed" in parsed
      && typeof parsed.collapsed === "boolean"
    ) {
      return { width: parsed.width, collapsed: parsed.collapsed };
    }
  } catch {
    return null;
  }

  return null;
}

function writePersisted(data: PersistedData): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      FILE_TREE_SIDEBAR_STORAGE_KEY,
      JSON.stringify(data),
    );
  } catch {
    // Browser storage can be unavailable in tests, privacy modes, or SSR-like previews.
  }
}
