import { create } from "zustand";
import type { WorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";

interface WorkspaceTabsState {
  activeShellTabKeyByWorkspace: Record<string, WorkspaceShellTabKey | null>;
  shellTabOrderByWorkspace: Record<string, WorkspaceShellTabKey[]>;
  setActiveShellTabKey: (
    workspaceId: string,
    key: WorkspaceShellTabKey | null,
  ) => void;
  setShellTabOrder: (
    workspaceId: string,
    order: WorkspaceShellTabKey[],
  ) => void;
  resetWorkspaceTabs: (workspaceId: string) => void;
  reset: () => void;
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>((set, get) => ({
  activeShellTabKeyByWorkspace: {},
  shellTabOrderByWorkspace: {},

  setActiveShellTabKey: (workspaceId, key) => {
    set({
      activeShellTabKeyByWorkspace: {
        ...get().activeShellTabKeyByWorkspace,
        [workspaceId]: key,
      },
    });
  },

  setShellTabOrder: (workspaceId, order) => {
    set({
      shellTabOrderByWorkspace: {
        ...get().shellTabOrderByWorkspace,
        [workspaceId]: order,
      },
    });
  },

  resetWorkspaceTabs: (workspaceId) => {
    const active = { ...get().activeShellTabKeyByWorkspace };
    const order = { ...get().shellTabOrderByWorkspace };
    delete active[workspaceId];
    delete order[workspaceId];
    set({
      activeShellTabKeyByWorkspace: active,
      shellTabOrderByWorkspace: order,
    });
  },

  reset: () => {
    set({
      activeShellTabKeyByWorkspace: {},
      shellTabOrderByWorkspace: {},
    });
  },
}));
