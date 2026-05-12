import {
  deleteManualChatGroup,
  removeSessionsFromManualChatGroups,
  updateManualChatGroup,
  upsertManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  clearHiddenChatSessionIds,
  rememberHiddenChatSessionId,
  uniqueIds,
} from "@/lib/domain/workspaces/tabs/visibility";
import { sameStringArray } from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { recordDebugActionDiagnostic } from "@/lib/infra/measurement/debug-action-diagnostic";
import type { WorkspaceUiGet, WorkspaceUiSet, WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

type WorkspaceUiChatTabActions = Pick<
  WorkspaceUiState,
  | "setUrgentHighlightedChatSessionForWorkspace"
  | "clearUrgentHighlightedChatSessionForWorkspace"
  | "setVisibleChatSessionIdsForWorkspace"
  | "rememberHiddenChatSessionForWorkspace"
  | "clearHiddenChatSessionsForWorkspace"
  | "toggleChatGroupCollapsedForWorkspace"
  | "clearChatGroupCollapsedForWorkspace"
  | "setManualChatGroupsForWorkspace"
  | "upsertManualChatGroupForWorkspace"
  | "updateManualChatGroupForWorkspace"
  | "deleteManualChatGroupForWorkspace"
  | "removeSessionsFromManualChatGroupsForWorkspace"
  | "clearWorkspaceChatTabState"
>;

export function createWorkspaceUiChatTabActions(
  set: WorkspaceUiSet,
  get: WorkspaceUiGet,
): WorkspaceUiChatTabActions {
  return {
    setUrgentHighlightedChatSessionForWorkspace: (workspaceId, sessionId) => {
      if (get().urgentHighlightedChatSessionByWorkspace[workspaceId] === sessionId) {
        recordDebugActionDiagnostic({
          category: "workspace_ui_store.action",
          label: "set_urgent_highlight_skipped",
          keys: [workspaceId, sessionId],
          detail: { workspaceId, sessionId },
        });
        return;
      }
      recordDebugActionDiagnostic({
        category: "workspace_ui_store.action",
        label: "set_urgent_highlight",
        keys: [workspaceId, sessionId],
        detail: {
          workspaceId,
          sessionId,
          previousSessionId: get().urgentHighlightedChatSessionByWorkspace[workspaceId] ?? null,
        },
      });
      set({
        urgentHighlightedChatSessionByWorkspace: {
          ...get().urgentHighlightedChatSessionByWorkspace,
          [workspaceId]: sessionId,
        },
      });
    },

    clearUrgentHighlightedChatSessionForWorkspace: (workspaceId, sessionId) => {
      const current = get().urgentHighlightedChatSessionByWorkspace[workspaceId] ?? null;
      if (!current || (sessionId !== undefined && current !== sessionId)) {
        recordDebugActionDiagnostic({
          category: "workspace_ui_store.action",
          label: "clear_urgent_highlight_skipped",
          keys: [workspaceId, sessionId ?? "any"],
          detail: {
            workspaceId,
            sessionId: sessionId ?? null,
            current,
          },
        });
        return;
      }
      recordDebugActionDiagnostic({
        category: "workspace_ui_store.action",
        label: "clear_urgent_highlight",
        keys: [workspaceId, current],
        detail: {
          workspaceId,
          sessionId: current,
          requestedSessionId: sessionId ?? null,
        },
      });
      set({
        urgentHighlightedChatSessionByWorkspace: {
          ...get().urgentHighlightedChatSessionByWorkspace,
          [workspaceId]: null,
        },
      });
    },

    setVisibleChatSessionIdsForWorkspace: (workspaceId, sessionIds) => {
      const nextSessionIds = uniqueIds(sessionIds);
      set((state) => {
        const hasCurrent = Object.prototype.hasOwnProperty.call(
          state.visibleChatSessionIdsByWorkspace,
          workspaceId,
        );
        const current = state.visibleChatSessionIdsByWorkspace[workspaceId] ?? [];
        if (hasCurrent && sameStringArray(current, nextSessionIds)) {
          return state;
        }
        recordDebugActionDiagnostic({
          category: "workspace_ui_store.action",
          label: "set_visible_chat_session_ids",
          keys: [workspaceId],
          detail: {
            workspaceId,
            previousCount: current.length,
            nextCount: nextSessionIds.length,
          },
        });
        return {
          visibleChatSessionIdsByWorkspace: {
            ...state.visibleChatSessionIdsByWorkspace,
            [workspaceId]: nextSessionIds,
          },
        };
      });
    },

    rememberHiddenChatSessionForWorkspace: (workspaceId, sessionId) => {
      const current =
        get().recentlyHiddenChatSessionIdsByWorkspace[workspaceId] ?? [];
      set({
        recentlyHiddenChatSessionIdsByWorkspace: {
          ...get().recentlyHiddenChatSessionIdsByWorkspace,
          [workspaceId]: rememberHiddenChatSessionId(current, sessionId),
        },
      });
    },

    clearHiddenChatSessionsForWorkspace: (workspaceId, sessionIds) => {
      const current =
        get().recentlyHiddenChatSessionIdsByWorkspace[workspaceId] ?? [];
      const next = clearHiddenChatSessionIds(current, sessionIds);
      if (next.length === current.length) {
        return;
      }
      set({
        recentlyHiddenChatSessionIdsByWorkspace: {
          ...get().recentlyHiddenChatSessionIdsByWorkspace,
          [workspaceId]: next,
        },
      });
    },

    toggleChatGroupCollapsedForWorkspace: (workspaceId, parentSessionId) => {
      const current =
        get().collapsedChatGroupsByWorkspace[workspaceId] ?? [];
      const next = current.includes(parentSessionId)
        ? current.filter((id) => id !== parentSessionId)
        : uniqueIds([...current, parentSessionId]);
      const collapsed = { ...get().collapsedChatGroupsByWorkspace };
      if (next.length > 0) {
        collapsed[workspaceId] = next;
      } else {
        delete collapsed[workspaceId];
      }
      set({ collapsedChatGroupsByWorkspace: collapsed });
    },

    clearChatGroupCollapsedForWorkspace: (workspaceId, parentSessionIds) => {
      const current =
        get().collapsedChatGroupsByWorkspace[workspaceId] ?? [];
      if (current.length === 0 || parentSessionIds.length === 0) {
        return;
      }
      const clearSet = new Set(parentSessionIds);
      const next = current.filter((id) => !clearSet.has(id));
      if (next.length === current.length) {
        return;
      }
      const collapsed = { ...get().collapsedChatGroupsByWorkspace };
      if (next.length > 0) {
        collapsed[workspaceId] = next;
      } else {
        delete collapsed[workspaceId];
      }
      set({ collapsedChatGroupsByWorkspace: collapsed });
    },

    setManualChatGroupsForWorkspace: (workspaceId, groups) => {
      const current = get().manualChatGroupsByWorkspace;
      const nextGroupsByWorkspace = { ...current };
      if (groups.length > 0) {
        nextGroupsByWorkspace[workspaceId] = groups;
      } else {
        delete nextGroupsByWorkspace[workspaceId];
      }
      set({ manualChatGroupsByWorkspace: nextGroupsByWorkspace });
    },

    upsertManualChatGroupForWorkspace: (workspaceId, group) => {
      const current = get().manualChatGroupsByWorkspace[workspaceId] ?? [];
      const nextGroups = upsertManualChatGroup(current, group);
      const nextGroupsByWorkspace = { ...get().manualChatGroupsByWorkspace };
      if (nextGroups.length > 0) {
        nextGroupsByWorkspace[workspaceId] = nextGroups;
      } else {
        delete nextGroupsByWorkspace[workspaceId];
      }
      set({ manualChatGroupsByWorkspace: nextGroupsByWorkspace });
    },

    updateManualChatGroupForWorkspace: (workspaceId, groupId, updates) => {
      const current = get().manualChatGroupsByWorkspace[workspaceId] ?? [];
      const nextGroups = updateManualChatGroup(current, groupId, updates);
      const nextGroupsByWorkspace = { ...get().manualChatGroupsByWorkspace };
      if (nextGroups.length > 0) {
        nextGroupsByWorkspace[workspaceId] = nextGroups;
      } else {
        delete nextGroupsByWorkspace[workspaceId];
      }
      set({ manualChatGroupsByWorkspace: nextGroupsByWorkspace });
    },

    deleteManualChatGroupForWorkspace: (workspaceId, groupId) => {
      const currentGroups = get().manualChatGroupsByWorkspace[workspaceId] ?? [];
      const nextGroups = deleteManualChatGroup(currentGroups, groupId);
      const nextGroupsByWorkspace = { ...get().manualChatGroupsByWorkspace };

      if (nextGroups.length > 0) {
        nextGroupsByWorkspace[workspaceId] = nextGroups;
      } else {
        delete nextGroupsByWorkspace[workspaceId];
      }
      set({ manualChatGroupsByWorkspace: nextGroupsByWorkspace });
    },

    removeSessionsFromManualChatGroupsForWorkspace: (workspaceId, sessionIds) => {
      const currentGroups = get().manualChatGroupsByWorkspace[workspaceId] ?? [];
      const nextGroups = removeSessionsFromManualChatGroups(currentGroups, sessionIds);
      const nextGroupsByWorkspace = { ...get().manualChatGroupsByWorkspace };

      if (nextGroups.length > 0) {
        nextGroupsByWorkspace[workspaceId] = nextGroups;
      } else {
        delete nextGroupsByWorkspace[workspaceId];
      }
      set({ manualChatGroupsByWorkspace: nextGroupsByWorkspace });
    },

    clearWorkspaceChatTabState: (workspaceId) => {
      const visible = { ...get().visibleChatSessionIdsByWorkspace };
      const hidden = { ...get().recentlyHiddenChatSessionIdsByWorkspace };
      const collapsed = { ...get().collapsedChatGroupsByWorkspace };
      const manualGroups = { ...get().manualChatGroupsByWorkspace };
      delete visible[workspaceId];
      delete hidden[workspaceId];
      delete collapsed[workspaceId];
      delete manualGroups[workspaceId];
      set({
        visibleChatSessionIdsByWorkspace: visible,
        recentlyHiddenChatSessionIdsByWorkspace: hidden,
        collapsedChatGroupsByWorkspace: collapsed,
        manualChatGroupsByWorkspace: manualGroups,
      });
    },
  };
}
