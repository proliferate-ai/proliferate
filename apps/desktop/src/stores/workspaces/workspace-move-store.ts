import { create } from "zustand";

// UI state for the workspace-move dialog (open/workspaceId, pattern:
// add-repo-flow-store.ts) plus a session-scoped memory of "which move id is this
// workspace's in-flight move" (spec section 2.2's recovery story: "a stale non-terminal
// row + engine preflight tells Desktop exactly what to offer"). There is no
// list-active-move-by-identity server endpoint (PR B's API is start/get-by-id/phase
// transitions only, spec section 5.2), so remembering the id locally is what lets the
// dialog re-offer resume/abandon after being closed and reopened. Deliberately
// in-memory only, not written to the persisted workspace-ui-store: losing it across an
// app restart just means the resume prompt doesn't come back automatically, and the
// user can still see the workspace is stuck via the normal preflight/runtime-state
// checks and start a fresh move.

interface WorkspaceMoveUiState {
  dialogOpen: boolean;
  dialogWorkspaceId: string | null;
  activeMoveIdByWorkspaceId: Record<string, string>;
  openMoveDialog: (workspaceId: string) => void;
  closeMoveDialog: () => void;
  setActiveMoveId: (workspaceId: string, moveId: string | null) => void;
}

export const useWorkspaceMoveStore = create<WorkspaceMoveUiState>((set, get) => ({
  dialogOpen: false,
  dialogWorkspaceId: null,
  activeMoveIdByWorkspaceId: {},

  openMoveDialog: (workspaceId) => set({ dialogOpen: true, dialogWorkspaceId: workspaceId }),
  closeMoveDialog: () => set({ dialogOpen: false, dialogWorkspaceId: null }),

  setActiveMoveId: (workspaceId, moveId) => {
    const current = get().activeMoveIdByWorkspaceId;
    if (moveId === null) {
      if (!(workspaceId in current)) return;
      const next = { ...current };
      delete next[workspaceId];
      set({ activeMoveIdByWorkspaceId: next });
      return;
    }
    if (current[workspaceId] === moveId) return;
    set({ activeMoveIdByWorkspaceId: { ...current, [workspaceId]: moveId } });
  },
}));

export function rememberActiveWorkspaceMoveId(workspaceId: string, moveId: string | null) {
  useWorkspaceMoveStore.getState().setActiveMoveId(workspaceId, moveId);
}
