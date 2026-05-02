import { create } from "zustand";
import type { GitDiffScope } from "@anyharness/sdk";

export interface ChangeReviewViewedKey {
  allChangesTargetKey: string;
  sectionScope: Exclude<GitDiffScope, "working_tree">;
  path: string;
  oldPath?: string | null;
}

interface WorkspaceChangeReviewState {
  viewedByKey: Record<string, true>;
  toggleViewed: (key: ChangeReviewViewedKey) => void;
  setViewed: (key: ChangeReviewViewedKey, viewed: boolean) => void;
  reset: () => void;
}

export const useWorkspaceChangeReviewStore = create<WorkspaceChangeReviewState>((set) => ({
  viewedByKey: {},
  toggleViewed: (key) => {
    const serialized = serializeViewedKey(key);
    set((current) => {
      const next = { ...current.viewedByKey };
      if (next[serialized]) {
        delete next[serialized];
      } else {
        next[serialized] = true;
      }
      return { viewedByKey: next };
    });
  },
  setViewed: (key, viewed) => {
    const serialized = serializeViewedKey(key);
    set((current) => {
      const next = { ...current.viewedByKey };
      if (viewed) {
        next[serialized] = true;
      } else {
        delete next[serialized];
      }
      return { viewedByKey: next };
    });
  },
  reset: () => set({ viewedByKey: {} }),
}));

export function serializeViewedKey(key: ChangeReviewViewedKey): string {
  return JSON.stringify({
    target: key.allChangesTargetKey,
    section: key.sectionScope,
    path: key.path,
    oldPath: key.oldPath ?? null,
  });
}
