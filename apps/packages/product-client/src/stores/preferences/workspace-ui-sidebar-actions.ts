import type { SidebarWorkspaceVariant } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import {
  toggleSidebarWorkspaceTypeSelection,
} from "#product/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import { clampWorkspaceSidebarWidth } from "#product/lib/domain/preferences/workspace-ui/sidebar";
import { nextWorkspacePinLocalOrder } from "#product/stores/preferences/workspace-ui-pin-local-order";
import { recordBoundedWorkspacePinLocalBarriers } from "#product/stores/preferences/workspace-ui-pin-local-barriers";
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
      const manualAt = nextWorkspacePinLocalOrder();
      set((state) => ({
        pinnedWorkspaceIds: state.pinnedWorkspaceIds.includes(id)
          ? state.pinnedWorkspaceIds
          : [...state.pinnedWorkspaceIds, id],
        workspacePinLocalBarrierById: recordBoundedWorkspacePinLocalBarriers(
          state.workspacePinLocalBarrierById,
          [id],
          manualAt,
        ),
      }));
    },

    // Removes every id the workspace answers to, so a pin recorded under a
    // former identity (alias/local-slot/materialization id) cannot survive.
    unpinWorkspace: (ids) => {
      if (ids.length === 0) {
        return;
      }
      const manualAt = nextWorkspacePinLocalOrder();
      const idSet = new Set(ids);
      set((state) => ({
        pinnedWorkspaceIds: state.pinnedWorkspaceIds.filter(
          (workspaceId) => !idSet.has(workspaceId),
        ),
        workspacePinLocalBarrierById: recordBoundedWorkspacePinLocalBarriers(
          state.workspacePinLocalBarrierById,
          ids,
          manualAt,
        ),
      }));
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
