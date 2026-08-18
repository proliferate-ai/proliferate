import { create } from "zustand";

interface WorkspaceArchiveVisibilityState {
  optimisticallyArchivedIds: ReadonlySet<string>;
  hideWorkspace: (workspaceId: string) => void;
  showWorkspace: (workspaceId: string) => void;
  reset: () => void;
}

export const useWorkspaceArchiveVisibilityStore = create<WorkspaceArchiveVisibilityState>(
  (set) => ({
    optimisticallyArchivedIds: new Set(),
    hideWorkspace: (workspaceId) => set((state) => {
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
    showWorkspace: (workspaceId) => set((state) => {
      if (!state.optimisticallyArchivedIds.has(workspaceId)) {
        return state;
      }
      const optimisticallyArchivedIds = new Set(state.optimisticallyArchivedIds);
      optimisticallyArchivedIds.delete(workspaceId);
      return { optimisticallyArchivedIds };
    }),
    reset: () => set((state) => state.optimisticallyArchivedIds.size === 0
      ? state
      : { optimisticallyArchivedIds: new Set() }),
  }),
);
