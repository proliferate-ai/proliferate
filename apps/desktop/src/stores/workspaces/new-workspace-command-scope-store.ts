import { create } from "zustand";
import type { NewWorkspaceCommandScope } from "@/lib/domain/workspaces/creation/new-workspace-command";

interface NewWorkspaceCommandScopeState {
  activeScope: NewWorkspaceCommandScope | null;
  setActiveScope: (scope: NewWorkspaceCommandScope) => void;
  clearActiveScope: (scopeId?: string | null) => void;
}

export const useNewWorkspaceCommandScopeStore = create<NewWorkspaceCommandScopeState>((set) => ({
  activeScope: null,
  setActiveScope: (scope) => set({ activeScope: scope }),
  clearActiveScope: (scopeId) => set((state) => {
    if (scopeId && state.activeScope?.id !== scopeId) {
      return state;
    }
    return { activeScope: null };
  }),
}));
