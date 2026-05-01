import { create } from "zustand";

export interface SidebarAutoShownMoreSelection {
  logicalWorkspaceId: string;
  selectedWorkspaceId: string;
  repoKey: string;
  workspaceSelectionNonce: number;
}

interface WorkspaceSidebarShowMoreState {
  repoGroupsShownMore: string[];
  repoGroupsShowMoreClearedByCollapse: string[];
  lastAutoShownMoreSelection: SidebarAutoShownMoreSelection | null;
  toggleRepoGroupShowMore: (repoKey: string) => void;
  ensureRepoGroupShowMore: (repoKey: string) => void;
  recordAutoRepoGroupShowMore: (selection: SidebarAutoShownMoreSelection) => void;
  clearRepoGroupShowMore: (repoKey: string) => void;
  clearRepoGroupsShowMore: (repoKeys: string[]) => void;
  clearRepoGroupShowMoreAfterCollapse: (repoKey: string) => void;
  clearRepoGroupsShowMoreAfterCollapse: (repoKeys: string[]) => void;
  clearAutoShownMoreSelection: () => void;
}

function uniqueRepoKeys(repoKeys: readonly string[]): string[] {
  const next: string[] = [];
  for (const repoKey of repoKeys) {
    if (repoKey && !next.includes(repoKey)) {
      next.push(repoKey);
    }
  }
  return next;
}

export const WORKSPACE_SIDEBAR_SHOW_MORE_DEFAULTS = {
  repoGroupsShownMore: [],
  repoGroupsShowMoreClearedByCollapse: [],
  lastAutoShownMoreSelection: null,
} satisfies Pick<
  WorkspaceSidebarShowMoreState,
  "repoGroupsShownMore" | "repoGroupsShowMoreClearedByCollapse" | "lastAutoShownMoreSelection"
>;

export const useWorkspaceSidebarShowMoreStore = create<WorkspaceSidebarShowMoreState>((set) => ({
  ...WORKSPACE_SIDEBAR_SHOW_MORE_DEFAULTS,

  toggleRepoGroupShowMore: (repoKey) => set((state) => ({
    repoGroupsShownMore: state.repoGroupsShownMore.includes(repoKey)
      ? state.repoGroupsShownMore.filter((key) => key !== repoKey)
      : [...state.repoGroupsShownMore, repoKey],
    repoGroupsShowMoreClearedByCollapse: state.repoGroupsShowMoreClearedByCollapse
      .filter((key) => key !== repoKey),
  })),

  ensureRepoGroupShowMore: (repoKey) => set((state) => {
    const isShownMore = state.repoGroupsShownMore.includes(repoKey);
    const wasClearedByCollapse = state.repoGroupsShowMoreClearedByCollapse.includes(repoKey);
    if (isShownMore && !wasClearedByCollapse) {
      return state;
    }
    return {
      repoGroupsShownMore: isShownMore
        ? state.repoGroupsShownMore
        : [...state.repoGroupsShownMore, repoKey],
      repoGroupsShowMoreClearedByCollapse: state.repoGroupsShowMoreClearedByCollapse
        .filter((key) => key !== repoKey),
    };
  }),

  recordAutoRepoGroupShowMore: (selection) => set((state) => ({
    repoGroupsShownMore: state.repoGroupsShownMore.includes(selection.repoKey)
      ? state.repoGroupsShownMore
      : [...state.repoGroupsShownMore, selection.repoKey],
    repoGroupsShowMoreClearedByCollapse: state.repoGroupsShowMoreClearedByCollapse
      .filter((key) => key !== selection.repoKey),
    lastAutoShownMoreSelection: selection,
  })),

  clearRepoGroupShowMore: (repoKey) => set((state) => {
    const hadShownMore = state.repoGroupsShownMore.includes(repoKey);
    const hadClearedByCollapse = state.repoGroupsShowMoreClearedByCollapse.includes(repoKey);
    if (!hadShownMore && !hadClearedByCollapse) {
      return state;
    }
    const nextShownMore = state.repoGroupsShownMore.filter((key) => key !== repoKey);
    const nextClearedByCollapse = state.repoGroupsShowMoreClearedByCollapse
      .filter((key) => key !== repoKey);
    return {
      repoGroupsShownMore: nextShownMore,
      repoGroupsShowMoreClearedByCollapse: nextClearedByCollapse,
    };
  }),

  clearRepoGroupsShowMore: (repoKeys) => set((state) => {
    const repoKeySet = new Set(uniqueRepoKeys(repoKeys));
    const nextShownMore = state.repoGroupsShownMore.filter((key) => !repoKeySet.has(key));
    const nextClearedByCollapse = state.repoGroupsShowMoreClearedByCollapse
      .filter((key) => !repoKeySet.has(key));
    if (
      repoKeySet.size === 0
      || (
        nextShownMore.length === state.repoGroupsShownMore.length
        && nextClearedByCollapse.length === state.repoGroupsShowMoreClearedByCollapse.length
      )
    ) {
      return state;
    }
    return {
      repoGroupsShownMore: nextShownMore,
      repoGroupsShowMoreClearedByCollapse: nextClearedByCollapse,
    };
  }),

  clearRepoGroupShowMoreAfterCollapse: (repoKey) => set((state) => {
    if (!state.repoGroupsShownMore.includes(repoKey)) {
      return state;
    }
    return {
      repoGroupsShownMore: state.repoGroupsShownMore.filter((key) => key !== repoKey),
      repoGroupsShowMoreClearedByCollapse: state.repoGroupsShowMoreClearedByCollapse.includes(repoKey)
        ? state.repoGroupsShowMoreClearedByCollapse
        : [...state.repoGroupsShowMoreClearedByCollapse, repoKey],
    };
  }),

  clearRepoGroupsShowMoreAfterCollapse: (repoKeys) => set((state) => {
    const repoKeySet = new Set(uniqueRepoKeys(repoKeys));
    const clearedKeys = state.repoGroupsShownMore.filter((key) => repoKeySet.has(key));
    if (repoKeySet.size === 0 || clearedKeys.length === 0) {
      return state;
    }
    return {
      repoGroupsShownMore: state.repoGroupsShownMore.filter((key) => !repoKeySet.has(key)),
      repoGroupsShowMoreClearedByCollapse: uniqueRepoKeys([
        ...state.repoGroupsShowMoreClearedByCollapse,
        ...clearedKeys,
      ]),
    };
  }),

  clearAutoShownMoreSelection: () => set((state) => {
    if (!state.lastAutoShownMoreSelection) {
      return state;
    }
    return { lastAutoShownMoreSelection: null };
  }),
}));
