import type { ReadWorkspaceFileResponse } from "@anyharness/sdk";
import { create } from "zustand";
import {
  pathIsWithinWorkspaceEntry,
  remapPathWithinWorkspaceEntry,
} from "@/lib/domain/workspaces/viewer/viewer-target";

export type FileSaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export interface WorkspaceFileBuffer {
  path: string;
  baseContent: string | null;
  localContent: string | null;
  baseVersionToken: string | null;
  saveState: FileSaveState;
  isDirty: boolean;
  lastError?: string | null;
}

interface WorkspaceFileBuffersState {
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  reset: () => void;
  ensureBufferFromRead: (path: string, result: ReadWorkspaceFileResponse) => void;
  replaceBufferFromRead: (path: string, result: ReadWorkspaceFileResponse) => void;
  updateBuffer: (path: string, content: string) => void;
  clearBuffer: (path: string) => void;
  renamePathPrefix: (fromPath: string, toPath: string) => void;
  clearPathPrefix: (path: string) => void;
  setBufferSaveState: (
    path: string,
    saveState: FileSaveState,
    lastError?: string | null,
  ) => void;
  applyFileSave: (path: string, versionToken: string, serverContent: string) => void;
}

export const useWorkspaceFileBuffersStore = create<WorkspaceFileBuffersState>((set) => ({
  buffersByPath: {},

  reset: () => set({ buffersByPath: {} }),

  ensureBufferFromRead: (path, result) => {
    const content = result.content;
    if (!result.isText || result.tooLarge || typeof content !== "string") {
      return;
    }
    const versionToken = result.versionToken ?? null;
    set((current) => {
      const existing = current.buffersByPath[path];
      if (existing) {
        if (existing.isDirty && existing.baseVersionToken !== versionToken) {
          return {
            buffersByPath: {
              ...current.buffersByPath,
              [path]: {
                ...existing,
                saveState: "conflict",
                lastError: "File changed on disk. Your local changes are preserved.",
              },
            },
          };
        }
        if (existing.baseVersionToken === versionToken) {
          return current;
        }
      }
      return {
        buffersByPath: {
          ...current.buffersByPath,
          [path]: {
            path,
            baseContent: content,
            localContent: content,
            baseVersionToken: versionToken,
            saveState: "idle",
            isDirty: false,
            lastError: null,
          },
        },
      };
    });
  },

  replaceBufferFromRead: (path, result) => {
    const content = result.content;
    set((current) => {
      if (!result.isText || result.tooLarge || typeof content !== "string") {
        const next = { ...current.buffersByPath };
        delete next[path];
        return { buffersByPath: next };
      }
      return {
        buffersByPath: {
          ...current.buffersByPath,
          [path]: {
            path,
            baseContent: content,
            localContent: content,
            baseVersionToken: result.versionToken ?? null,
            saveState: "idle",
            isDirty: false,
            lastError: null,
          },
        },
      };
    });
  },

  updateBuffer: (path, content) => {
    set((current) => {
      const existing = current.buffersByPath[path];
      if (!existing) {
        return current;
      }
      return {
        buffersByPath: {
          ...current.buffersByPath,
          [path]: {
            ...existing,
            localContent: content,
            isDirty: content !== existing.baseContent,
            saveState: "idle",
            lastError: null,
          },
        },
      };
    });
  },

  clearBuffer: (path) => {
    set((current) => {
      if (!current.buffersByPath[path]) {
        return current;
      }
      const next = { ...current.buffersByPath };
      delete next[path];
      return { buffersByPath: next };
    });
  },

  renamePathPrefix: (fromPath, toPath) => {
    set((current) => {
      let changed = false;
      const next: Record<string, WorkspaceFileBuffer> = {};
      for (const [path, buffer] of Object.entries(current.buffersByPath)) {
        const nextPath = remapPathWithinWorkspaceEntry(path, fromPath, toPath);
        changed ||= nextPath !== path;
        next[nextPath] = {
          ...buffer,
          path: nextPath,
        };
      }
      return changed ? { buffersByPath: next } : current;
    });
  },

  clearPathPrefix: (path) => {
    set((current) => {
      let changed = false;
      const next: Record<string, WorkspaceFileBuffer> = {};
      for (const [bufferPath, buffer] of Object.entries(current.buffersByPath)) {
        if (pathIsWithinWorkspaceEntry(bufferPath, path)) {
          changed = true;
          continue;
        }
        next[bufferPath] = buffer;
      }
      return changed ? { buffersByPath: next } : current;
    });
  },

  setBufferSaveState: (path, saveState, lastError = null) => {
    set((current) => {
      const existing = current.buffersByPath[path];
      if (!existing) {
        return current;
      }
      return {
        buffersByPath: {
          ...current.buffersByPath,
          [path]: {
            ...existing,
            saveState,
            lastError,
          },
        },
      };
    });
  },

  applyFileSave: (path, versionToken, serverContent) => {
    set((current) => {
      const existing = current.buffersByPath[path];
      if (!existing) {
        return current;
      }
      const localContent = existing.localContent ?? serverContent;
      const isDirty = localContent !== serverContent;
      return {
        buffersByPath: {
          ...current.buffersByPath,
          [path]: {
            ...existing,
            baseContent: serverContent,
            localContent,
            baseVersionToken: versionToken,
            isDirty,
            saveState: isDirty ? "idle" : "saved",
            lastError: null,
          },
        },
      };
    });
  },
}));
