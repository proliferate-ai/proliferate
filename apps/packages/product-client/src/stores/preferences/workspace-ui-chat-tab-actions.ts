import {
  deleteManualChatGroup,
  removeSessionsFromManualChatGroups,
  updateManualChatGroup,
  upsertManualChatGroup,
} from "#product/lib/domain/workspaces/tabs/manual-groups";
import {
  clearHiddenChatSessionIds,
  preservesVisibleChatSession,
  rememberHiddenChatSessionId,
  resolveChatSessionIdsToHide,
  resolveFallbackAfterHidingChatTabs,
  resolveVisibleChatSessionIds,
  uniqueIds,
} from "#product/lib/domain/workspaces/tabs/visibility";
import { sameStringArray } from "#product/lib/domain/workspaces/selection/workspace-keyed-preferences";
import type { WorkspaceUiGet, WorkspaceUiSet, WorkspaceUiState } from "#product/stores/preferences/workspace-ui-store-types";

type WorkspaceUiChatTabActions = Pick<
  WorkspaceUiState,
  | "setUrgentHighlightedChatSessionForWorkspace"
  | "clearUrgentHighlightedChatSessionForWorkspace"
  | "setVisibleChatSessionIdsForWorkspace"
  | "rememberHiddenChatSessionForWorkspace"
  | "clearHiddenChatSessionsForWorkspace"
  | "reserveChatSessionArchiveForWorkspace"
  | "completeChatSessionArchiveForWorkspace"
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
        return;
      }
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
        return;
      }
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

    reserveChatSessionArchiveForWorkspace: (input) => {
      let reservation: ReturnType<
        WorkspaceUiState["reserveChatSessionArchiveForWorkspace"]
      > = { kind: "blocked" };
      set((state) => {
        const childToParent = new Map(
          input.liveSessions
            .filter((session) => !!session.parentSessionId)
            .map((session) => [session.sessionId, session.parentSessionId!]),
        );
        const sessionIds = resolveChatSessionIdsToHide({
          sessionIds: [input.sessionId],
          childToParent,
        });
        const inFlight = new Set(
          state.archivingChatSessionIdsByWorkspace[input.workspaceId] ?? [],
        );
        if (sessionIds.some((sessionId) => inFlight.has(sessionId))) {
          return state;
        }

        const hasPersistedVisible = Object.prototype.hasOwnProperty.call(
          state.visibleChatSessionIdsByWorkspace,
          input.workspaceId,
        );
        const visibleSessionIds = resolveVisibleChatSessionIds({
          activeSessionId: input.activeSessionId,
          liveSessions: input.liveSessions,
          persistedVisibleIds: hasPersistedVisible
            ? state.visibleChatSessionIdsByWorkspace[input.workspaceId]
            : undefined,
          recentlyHiddenIds:
            state.recentlyHiddenChatSessionIdsByWorkspace[input.workspaceId] ?? [],
        }).visibleSessionIds;
        const visibleArchiveIds = sessionIds.filter((sessionId) =>
          visibleSessionIds.includes(sessionId)
        );
        if (
          visibleArchiveIds.length > 0
          && !preservesVisibleChatSession({
            visibleSessionIds,
            sessionIdsToHide: sessionIds,
            childToParent,
          })
        ) {
          return state;
        }

        const replacesActiveSession = input.activeSessionId !== null
          && sessionIds.includes(input.activeSessionId);
        const fallbackSessionId = replacesActiveSession
          ? resolveFallbackAfterHidingChatTabs({
              activeSessionId: input.activeSessionId,
              idsToHide: sessionIds,
              visibleIdsBeforeHide: visibleSessionIds,
            })
          : null;
        const hideSet = new Set(sessionIds);
        const nextVisible = visibleSessionIds.filter((sessionId) => !hideSet.has(sessionId));
        const currentHidden =
          state.recentlyHiddenChatSessionIdsByWorkspace[input.workspaceId] ?? [];
        const nextHidden = sessionIds.reduce(
          (hidden, sessionId) => rememberHiddenChatSessionId(hidden, sessionId),
          currentHidden,
        );
        reservation = {
          kind: "reserved",
          fallbackSessionId,
          replacesActiveSession,
          sessionIds,
        };
        return {
          archivingChatSessionIdsByWorkspace: {
            ...state.archivingChatSessionIdsByWorkspace,
            [input.workspaceId]: uniqueIds([...inFlight, ...sessionIds]),
          },
          recentlyHiddenChatSessionIdsByWorkspace: {
            ...state.recentlyHiddenChatSessionIdsByWorkspace,
            [input.workspaceId]: nextHidden,
          },
          visibleChatSessionIdsByWorkspace: {
            ...state.visibleChatSessionIdsByWorkspace,
            [input.workspaceId]: nextVisible,
          },
        };
      });
      return reservation;
    },

    completeChatSessionArchiveForWorkspace: (workspaceId, sessionIds) => {
      set((state) => {
        const current = state.archivingChatSessionIdsByWorkspace[workspaceId] ?? [];
        if (current.length === 0) {
          return state;
        }
        const completed = new Set(sessionIds);
        const next = current.filter((sessionId) => !completed.has(sessionId));
        const byWorkspace = { ...state.archivingChatSessionIdsByWorkspace };
        if (next.length > 0) {
          byWorkspace[workspaceId] = next;
        } else {
          delete byWorkspace[workspaceId];
        }
        return { archivingChatSessionIdsByWorkspace: byWorkspace };
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
      const archiving = { ...get().archivingChatSessionIdsByWorkspace };
      const collapsed = { ...get().collapsedChatGroupsByWorkspace };
      const manualGroups = { ...get().manualChatGroupsByWorkspace };
      delete visible[workspaceId];
      delete hidden[workspaceId];
      delete archiving[workspaceId];
      delete collapsed[workspaceId];
      delete manualGroups[workspaceId];
      set({
        visibleChatSessionIdsByWorkspace: visible,
        recentlyHiddenChatSessionIdsByWorkspace: hidden,
        archivingChatSessionIdsByWorkspace: archiving,
        collapsedChatGroupsByWorkspace: collapsed,
        manualChatGroupsByWorkspace: manualGroups,
      });
    },
  };
}
