import { create } from "zustand";

export interface PendingBranchRenameState {
  workspaceId: string;
  placeholderBranch: string;
  startedAt: number;
  cloudWorkspaceId: string | null;
}

interface BranchRenameStoreState {
  pendingByWorkspaceId: Record<string, PendingBranchRenameState>;
  setPendingRename: (pending: PendingBranchRenameState) => void;
  clearPendingRename: (workspaceId: string) => void;
}

export const useBranchRenameStore = create<BranchRenameStoreState>((set) => ({
  pendingByWorkspaceId: {},
  setPendingRename: (pending) =>
    set((state) => ({
      pendingByWorkspaceId: {
        ...state.pendingByWorkspaceId,
        [pending.workspaceId]: pending,
      },
    })),
  clearPendingRename: (workspaceId) =>
    set((state) => {
      if (!(workspaceId in state.pendingByWorkspaceId)) {
        return state;
      }

      const nextPending = { ...state.pendingByWorkspaceId };
      delete nextPending[workspaceId];
      return { pendingByWorkspaceId: nextPending };
    }),
}));
