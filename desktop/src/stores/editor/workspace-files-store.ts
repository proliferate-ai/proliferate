import type {
  WorkspaceFileEntry,
  ReadWorkspaceFileResponse,
} from "@anyharness/sdk";
import { create } from "zustand";

type FileLoadState = "idle" | "loading" | "loaded" | "error";
type FileSaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export interface WorkspaceFileBuffer {
  path: string;
  serverContent: string | null;
  localContent: string | null;
  versionToken: string | null;
  isText: boolean;
  tooLarge: boolean;
  loadState: FileLoadState;
  saveState: FileSaveState;
  isDirty: boolean;
  lastError?: string | null;
}

interface WorkspaceFilesState {
  workspaceId: string | null;
  runtimeWorkspaceId: string | null;
  runtimeUrl: string | null;
  authToken: string | null;
  treeStateKey: string | null;
  initVersion: number;

  directoryEntriesByPath: Record<string, WorkspaceFileEntry[]>;
  directoryLoadStateByPath: Record<string, FileLoadState>;

  openTabs: string[];
  activeFilePath: string | null;
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  tabModes: Record<string, "edit" | "diff">;
  tabPatches: Record<string, string | null>;

  // Actions
  prepareWorkspace: (
    workspaceId: string,
    runtimeUrl: string,
    treeStateKey: string,
    runtimeWorkspaceId?: string,
    authToken?: string,
  ) => number;
  reset: () => void;
  setDirectoryLoadState: (dirPath: string, state: FileLoadState) => void;
  setDirectoryEntries: (dirPath: string, entries: WorkspaceFileEntry[]) => void;
  focusFileTab: (filePath: string) => void;
  setDiffTab: (filePath: string, patch: string | null) => void;
  closeTab: (filePath: string) => void;
  reorderOpenTabs: (orderedPaths: string[]) => void;
  setActiveTab: (filePath: string) => void;
  setTabMode: (filePath: string, mode: "edit" | "diff") => void;
  setBufferLoading: (filePath: string) => void;
  setBufferLoaded: (filePath: string, result: ReadWorkspaceFileResponse) => void;
  setBufferLoadError: (filePath: string, error: string) => void;
  updateBuffer: (filePath: string, content: string) => void;
  setBufferSaveState: (
    filePath: string,
    saveState: FileSaveState,
    lastError?: string | null,
  ) => void;
  applyFileSave: (filePath: string, versionToken: string, serverContent: string) => void;
}

function emptyFilesState() {
  return {
    directoryEntriesByPath: {} as Record<string, WorkspaceFileEntry[]>,
    directoryLoadStateByPath: {} as Record<string, FileLoadState>,
    openTabs: [] as string[],
    activeFilePath: null as string | null,
    buffersByPath: {} as Record<string, WorkspaceFileBuffer>,
    tabModes: {} as Record<string, "edit" | "diff">,
    tabPatches: {} as Record<string, string | null>,
  };
}

function createLoadingBuffer(filePath: string): WorkspaceFileBuffer {
  return {
    path: filePath,
    serverContent: null,
    localContent: null,
    versionToken: null,
    isText: false,
    tooLarge: false,
    loadState: "loading",
    saveState: "idle",
    isDirty: false,
    lastError: null,
  };
}

function bufferFromResponse(
  filePath: string,
  result: ReadWorkspaceFileResponse,
): WorkspaceFileBuffer {
  return {
    path: filePath,
    serverContent: result.content,
    localContent: result.content,
    versionToken: result.versionToken,
    isText: result.isText,
    tooLarge: result.tooLarge,
    loadState: "loaded",
    saveState: "idle",
    isDirty: false,
    lastError: null,
  };
}

export const useWorkspaceFilesStore = create<WorkspaceFilesState>((set, get) => ({
  workspaceId: null,
  runtimeWorkspaceId: null,
  runtimeUrl: null,
  authToken: null,
  treeStateKey: null,
  initVersion: 0,
  ...emptyFilesState(),

  prepareWorkspace: (
    workspaceId,
    runtimeUrl,
    treeStateKey,
    runtimeWorkspaceId,
    authToken,
  ) => {
    const resolvedRuntimeWorkspaceId = runtimeWorkspaceId ?? workspaceId;
    const initVersion = get().initVersion + 1;
    set({
      workspaceId,
      runtimeWorkspaceId: resolvedRuntimeWorkspaceId,
      runtimeUrl,
      authToken: authToken ?? null,
      treeStateKey,
      initVersion,
      ...emptyFilesState(),
      directoryLoadStateByPath: { "": "loading" },
    });
    return initVersion;
  },

  reset: () => {
    const initVersion = get().initVersion + 1;
    set({
      workspaceId: null,
      runtimeWorkspaceId: null,
      runtimeUrl: null,
      authToken: null,
      treeStateKey: null,
      initVersion,
      ...emptyFilesState(),
    });
  },

  setDirectoryLoadState: (dirPath, state) => {
    set((current) => ({
      directoryLoadStateByPath: {
        ...current.directoryLoadStateByPath,
        [dirPath]: state,
      },
    }));
  },

  setDirectoryEntries: (dirPath, entries) => {
    set((current) => ({
      directoryEntriesByPath: {
        ...current.directoryEntriesByPath,
        [dirPath]: entries,
      },
      directoryLoadStateByPath: {
        ...current.directoryLoadStateByPath,
        [dirPath]: "loaded",
      },
    }));
  },

  focusFileTab: (filePath) => {
    const openTabs = get().openTabs.includes(filePath)
      ? get().openTabs
      : [...get().openTabs, filePath];
    set({
      openTabs,
      activeFilePath: filePath,
    });
  },

  closeTab: (filePath) => {
    const { openTabs, activeFilePath, buffersByPath } = get();
    const nextTabs = openTabs.filter((t) => t !== filePath);

    const nextActive = activeFilePath === filePath
      ? nextTabs[nextTabs.length - 1] ?? null
      : activeFilePath;

    const nextBuffers = { ...buffersByPath };
    delete nextBuffers[filePath];

    const nextModes = { ...get().tabModes };
    delete nextModes[filePath];
    const nextPatches = { ...get().tabPatches };
    delete nextPatches[filePath];

    set({
      openTabs: nextTabs,
      activeFilePath: nextActive,
      buffersByPath: nextBuffers,
      tabModes: nextModes,
      tabPatches: nextPatches,
    });
  },

  reorderOpenTabs: (orderedPaths) => {
    const currentSet = new Set(get().openTabs);
    const next = orderedPaths.filter((path) => currentSet.has(path));
    for (const path of get().openTabs) {
      if (!next.includes(path)) {
        next.push(path);
      }
    }
    set({ openTabs: next });
  },

  setDiffTab: (filePath, patch) => {
    const openTabs = get().openTabs.includes(filePath)
      ? get().openTabs
      : [...get().openTabs, filePath];
    set({
      openTabs,
      activeFilePath: filePath,
      tabModes: { ...get().tabModes, [filePath]: "diff" },
      tabPatches: { ...get().tabPatches, [filePath]: patch },
    });
  },

  setBufferLoading: (filePath) => {
    set((current) => {
      const existing = current.buffersByPath[filePath];
      return {
        buffersByPath: {
          ...current.buffersByPath,
          [filePath]: existing
            ? {
              ...existing,
              loadState: "loading",
              saveState: "idle",
              lastError: null,
            }
            : createLoadingBuffer(filePath),
        },
      };
    });
  },

  setActiveTab: (filePath) => {
    set({ activeFilePath: filePath });
  },

  setTabMode: (filePath, mode) => {
    set({ tabModes: { ...get().tabModes, [filePath]: mode } });
  },

  setBufferLoaded: (filePath, result) => {
    set((current) => ({
      buffersByPath: {
        ...current.buffersByPath,
        [filePath]: bufferFromResponse(filePath, result),
      },
    }));
  },

  setBufferLoadError: (filePath, error) => {
    set((current) => {
      const existing = current.buffersByPath[filePath] ?? createLoadingBuffer(filePath);
      return {
        buffersByPath: {
          ...current.buffersByPath,
          [filePath]: {
            ...existing,
            loadState: "error",
            lastError: error,
          },
        },
      };
    });
  },

  updateBuffer: (filePath, content) => {
    set((s) => {
      const buf = s.buffersByPath[filePath];
      if (!buf) return s;
      return {
        buffersByPath: {
          ...s.buffersByPath,
          [filePath]: {
            ...buf,
            localContent: content,
            isDirty: content !== buf.serverContent,
            saveState: "idle",
          },
        },
      };
    });
  },

  setBufferSaveState: (filePath, saveState, lastError = null) => {
    set((current) => {
      const existing = current.buffersByPath[filePath];
      if (!existing) {
        return current;
      }
      return {
        buffersByPath: {
          ...current.buffersByPath,
          [filePath]: {
            ...existing,
            saveState,
            lastError,
          },
        },
      };
    });
  },

  applyFileSave: (filePath, versionToken, serverContent) => {
    set((current) => {
      const existing = current.buffersByPath[filePath];
      if (!existing) {
        return current;
      }
      return {
        buffersByPath: {
          ...current.buffersByPath,
          [filePath]: {
            ...existing,
            serverContent,
            versionToken,
            isDirty: false,
            saveState: "saved",
            lastError: null,
          },
        },
      };
    });
  },
}));
