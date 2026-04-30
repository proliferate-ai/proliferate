import { create } from "zustand";
import type { WorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";

const EMPTY_SHELL_TAB_ORDER_KEYS: readonly WorkspaceShellTabKey[] = [];

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
    const current = get().activeShellTabKeyByWorkspace[workspaceId] ?? null;
    if (current === key) {
      return;
    }
    set({
      activeShellTabKeyByWorkspace: {
        ...get().activeShellTabKeyByWorkspace,
        [workspaceId]: key,
      },
    });
  },

  setShellTabOrder: (workspaceId, order) => {
    const current = get().shellTabOrderByWorkspace[workspaceId] ?? EMPTY_SHELL_TAB_ORDER_KEYS;
    if (sameStringArray(current, order)) {
      return;
    }
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

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
