import { create } from "zustand";
import type { GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";

export interface GitPanelModeRequest {
  mode: GitPanelMode;
  token: number;
}

interface GitPanelUiState {
  modeRequestsByWorkspace: Record<string, GitPanelModeRequest>;
  requestModeForWorkspace: (workspaceId: string, mode: GitPanelMode) => void;
}

export const useGitPanelUiStore = create<GitPanelUiState>((set) => ({
  modeRequestsByWorkspace: {},

  requestModeForWorkspace: (workspaceId, mode) => {
    set((state) => {
      const previous = state.modeRequestsByWorkspace[workspaceId];
      return {
        modeRequestsByWorkspace: {
          ...state.modeRequestsByWorkspace,
          [workspaceId]: {
            mode,
            token: (previous?.token ?? 0) + 1,
          },
        },
      };
    });
  },
}));
