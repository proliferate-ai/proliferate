import { create } from "zustand";

interface WorkspaceArchiveVisibilityState {
  activeOwnerGeneration: number | null;
  optimisticallyArchivedIds: ReadonlySet<string>;
  beginOwner: () => number;
  endOwner: (generation: number) => void;
  hideWorkspace: (generation: number, workspaceId: string) => void;
  showWorkspace: (generation: number, workspaceId: string) => void;
}

let nextOwnerGeneration = 0;

export const useWorkspaceArchiveVisibilityStore = create<WorkspaceArchiveVisibilityState>(
  (set) => ({
    activeOwnerGeneration: null,
    optimisticallyArchivedIds: new Set(),
    beginOwner: () => {
      const generation = ++nextOwnerGeneration;
      set({ activeOwnerGeneration: generation, optimisticallyArchivedIds: new Set() });
      return generation;
    },
    endOwner: (generation) => set((state) => state.activeOwnerGeneration === generation
      ? { activeOwnerGeneration: null, optimisticallyArchivedIds: new Set() }
      : state),
    hideWorkspace: (generation, workspaceId) => set((state) => {
      if (state.activeOwnerGeneration !== generation) {
        return state;
      }
      if (state.optimisticallyArchivedIds.has(workspaceId)) {
        return state;
      }
      return {
        optimisticallyArchivedIds: new Set([
          ...state.optimisticallyArchivedIds,
          workspaceId,
        ]),
      };
    }),
    showWorkspace: (generation, workspaceId) => set((state) => {
      if (state.activeOwnerGeneration !== generation) {
        return state;
      }
      if (!state.optimisticallyArchivedIds.has(workspaceId)) {
        return state;
      }
      const optimisticallyArchivedIds = new Set(state.optimisticallyArchivedIds);
      optimisticallyArchivedIds.delete(workspaceId);
      return { optimisticallyArchivedIds };
    }),
  }),
);
