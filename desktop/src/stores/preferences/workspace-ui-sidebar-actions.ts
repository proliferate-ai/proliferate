import type { SidebarWorkspaceVariant } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import {
  toggleSidebarWorkspaceTypeSelection,
} from "@/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import { clampWorkspaceSidebarWidth } from "@/lib/domain/preferences/workspace-ui/sidebar";
import { resolveStateValue } from "@/stores/preferences/workspace-ui-state-value";
import type { WorkspaceUiGet, WorkspaceUiSet, WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

type WorkspaceUiSidebarActions = Pick<
  WorkspaceUiState,
  | "archiveWorkspace"
  | "archiveWorkspaces"
  | "unarchiveWorkspace"
  | "unarchiveWorkspaces"
  | "hideRepoRoot"
  | "unhideRepoRoot"
  | "toggleRepoGroupCollapsed"
  | "ensureRepoGroupExpanded"
  | "setCollapsedRepoGroups"
  | "setShowArchived"
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
    archiveWorkspace: (id) => {
      const current = get().archivedWorkspaceIds;
      if (current.includes(id)) {
        return;
      }
      set({ archivedWorkspaceIds: [...current, id] });
    },

    archiveWorkspaces: (ids) => {
      const current = get().archivedWorkspaceIds;
      const currentSet = new Set(current);
      const newIds = ids.filter((id) => !currentSet.has(id));
      if (newIds.length === 0) {
        return;
      }
      set({ archivedWorkspaceIds: [...current, ...newIds] });
    },

    unarchiveWorkspace: (id) => {
      const current = get().archivedWorkspaceIds;
      const next = current.filter((workspaceId) => workspaceId !== id);
      if (next.length === current.length) {
        return;
      }
      set({ archivedWorkspaceIds: next });
    },

    unarchiveWorkspaces: (ids) => {
      if (ids.length === 0) {
        return;
      }
      const idSet = new Set(ids);
      const current = get().archivedWorkspaceIds;
      const next = current.filter((workspaceId) => !idSet.has(workspaceId));
      if (next.length === current.length) {
        return;
      }
      set({ archivedWorkspaceIds: next });
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
