import type { SidebarWorkspaceVariant } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import {
  toggleSidebarWorkspaceTypeSelection,
} from "#product/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import { clampWorkspaceSidebarWidth } from "#product/lib/domain/preferences/workspace-ui/sidebar";
import { resolveStateValue } from "#product/stores/preferences/workspace-ui-state-value";
import type { WorkspaceUiGet, WorkspaceUiSet, WorkspaceUiState } from "#product/stores/preferences/workspace-ui-store-types";

type WorkspaceUiSidebarActions = Pick<
  WorkspaceUiState,
  | "pinWorkspace"
  | "unpinWorkspace"
  | "hideRepoRoot"
  | "unhideRepoRoot"
  | "toggleRepoGroupCollapsed"
  | "ensureRepoGroupExpanded"
  | "setCollapsedRepoGroups"
  | "setShowArchived"
  | "setRepositoriesCollapsed"
  | "setThreadsCollapsed"
  | "setSidebarOpen"
  | "setSidebarWidth"
  | "toggleSidebarWorkspaceType"
>;

export function createWorkspaceUiSidebarActions(
  set: WorkspaceUiSet,
  get: WorkspaceUiGet,
): WorkspaceUiSidebarActions {
  return {
    pinWorkspace: (id) => {
      const current = get().pinnedWorkspaceIds;
      if (current.includes(id)) {
        return;
      }
      set({ pinnedWorkspaceIds: [...current, id] });
    },

    // Removes every id the workspace answers to, so a pin recorded under a
    // former identity (alias/local-slot/materialization id) cannot survive.
    unpinWorkspace: (ids) => {
      const idSet = new Set(ids);
      const current = get().pinnedWorkspaceIds;
      const next = current.filter((workspaceId) => !idSet.has(workspaceId));
      if (next.length === current.length) {
        return;
      }
      set({ pinnedWorkspaceIds: next });
    },

    hideRepoRoot: (repoRootId) => {
      const current = get().hiddenRepoRootIds;
      if (current.includes(repoRootId)) {
        return;
      }
      set({ hiddenRepoRootIds: [...current, repoRootId] });
    },

    unhideRepoRoot: (repoRootId) => {
      const current = get().hiddenRepoRootIds;
      const next = current.filter((id) => id !== repoRootId);
      if (next.length === current.length) {
        return;
      }
      set({ hiddenRepoRootIds: next });
    },

    toggleRepoGroupCollapsed: (repoKey) => {
      const current = get().collapsedRepoGroups;
      set({
        collapsedRepoGroups: current.includes(repoKey)
          ? current.filter((k) => k !== repoKey)
          : [...current, repoKey],
      });
    },

    ensureRepoGroupExpanded: (repoKey) => {
      const current = get().collapsedRepoGroups;
      if (!current.includes(repoKey)) return;
      set({ collapsedRepoGroups: current.filter((k) => k !== repoKey) });
    },

    setCollapsedRepoGroups: (keys) => {
      set({ collapsedRepoGroups: keys });
    },

    setShowArchived: (value) => {
      set({ showArchived: value });
    },

    setRepositoriesCollapsed: (value) => {
      set({ repositoriesCollapsed: value });
    },

    setThreadsCollapsed: (value) => {
      set({ threadsCollapsed: value });
    },

    setSidebarOpen: (value) => {
      set((state) => ({
        sidebarOpen: resolveStateValue(value, state.sidebarOpen),
      }));
    },

    setSidebarWidth: (value) => {
      set((state) => ({
        sidebarWidth: clampWorkspaceSidebarWidth(
          resolveStateValue(value, state.sidebarWidth),
        ),
      }));
    },

    toggleSidebarWorkspaceType: (type: SidebarWorkspaceVariant) => {
      set((state) => ({
        workspaceTypes: toggleSidebarWorkspaceTypeSelection(state.workspaceTypes, type),
      }));
    },
  };
}
