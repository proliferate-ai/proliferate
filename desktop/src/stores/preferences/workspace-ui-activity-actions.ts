import type { WorkspaceUiGet, WorkspaceUiSet, WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

type WorkspaceUiActivityActions = Pick<
  WorkspaceUiState,
  | "markWorkspaceViewed"
  | "markWorkspaceViewedAt"
  | "setLastViewedSessionForWorkspace"
  | "clearLastViewedSessionForWorkspace"
  | "markSessionErrorViewed"
  | "clearViewedSessionErrors"
  | "updateWorkspaceLastInteracted"
>;

export function createWorkspaceUiActivityActions(
  set: WorkspaceUiSet,
  get: WorkspaceUiGet,
): WorkspaceUiActivityActions {
  return {
    markWorkspaceViewed: (workspaceId) => {
      set({
        lastViewedAt: {
          ...get().lastViewedAt,
          [workspaceId]: new Date().toISOString(),
        },
      });
    },

    markWorkspaceViewedAt: (workspaceId, timestamp) => {
      set((state) => {
        const current = state.lastViewedAt[workspaceId];
        if (current && new Date(current).getTime() >= new Date(timestamp).getTime()) {
          return state;
        }
        return {
          lastViewedAt: {
            ...state.lastViewedAt,
            [workspaceId]: timestamp,
          },
        };
      });
    },

    setLastViewedSessionForWorkspace: (workspaceId, sessionId) => {
      set((state) => {
        if (state.lastViewedSessionByWorkspace[workspaceId] === sessionId) {
          return state;
        }
        return {
          lastViewedSessionByWorkspace: {
            ...state.lastViewedSessionByWorkspace,
            [workspaceId]: sessionId,
          },
        };
      });
    },

    clearLastViewedSessionForWorkspace: (workspaceId, sessionId) => {
      const current = get().lastViewedSessionByWorkspace;
      const existing = current[workspaceId];
      if (!existing) {
        return;
      }
      if (sessionId && existing !== sessionId) {
        return;
      }
      const updated = { ...current };
      delete updated[workspaceId];
      set({ lastViewedSessionByWorkspace: updated });
    },

    markSessionErrorViewed: (sessionId, errorAt) => {
      const current = get().lastViewedSessionErrorAtBySession;
      if (current[sessionId] === errorAt) {
        return;
      }
      set({
        lastViewedSessionErrorAtBySession: {
          ...current,
          [sessionId]: errorAt,
        },
      });
    },

    clearViewedSessionErrors: (sessionIds) => {
      if (sessionIds.length === 0) {
        return;
      }
      const clearSet = new Set(sessionIds);
      const current = get().lastViewedSessionErrorAtBySession;
      const next = { ...current };
      let didClear = false;
      for (const sessionId of clearSet) {
        if (sessionId in next) {
          delete next[sessionId];
          didClear = true;
        }
      }
      if (!didClear) {
        return;
      }
      set({ lastViewedSessionErrorAtBySession: next });
    },

    updateWorkspaceLastInteracted: (workspaceId, timestamp) => {
      const current = get().workspaceLastInteracted[workspaceId];
      if (current && new Date(current).getTime() >= new Date(timestamp).getTime()) {
        return;
      }
      set({
        workspaceLastInteracted: {
          ...get().workspaceLastInteracted,
          [workspaceId]: timestamp,
        },
      });
    },
  };
}
