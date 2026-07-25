import { create } from "zustand";
import { WORKSPACE_UI_DEFAULTS } from "@/lib/domain/preferences/workspace-ui/model";
import {
  getChangedWorkspaceUiStateKeys,
  isNonPersistedWorkspaceUiStateKey,
} from "@/lib/domain/preferences/workspace-ui/persistence";
import type { PersistedWorkspaceGitStatusSnapshot } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import { createWorkspaceUiActivityActions } from "@/stores/preferences/workspace-ui-activity-actions";
import { createWorkspaceUiChatTabActions } from "@/stores/preferences/workspace-ui-chat-tab-actions";
import { createWorkspaceUiDismissalActions } from "@/stores/preferences/workspace-ui-dismissal-actions";
import { createWorkspaceUiGitStatusActions } from "@/stores/preferences/workspace-ui-git-status-actions";
import { createWorkspaceUiRightPanelActions } from "@/stores/preferences/workspace-ui-right-panel-actions";
import { createWorkspaceUiShellActions } from "@/stores/preferences/workspace-ui-shell-actions";
import { createWorkspaceUiSidebarActions } from "@/stores/preferences/workspace-ui-sidebar-actions";
import type { WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";
import type { WorkspaceUiSet } from "@/stores/preferences/workspace-ui-store-types";

export type { ShellIntentResult, WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

export const useWorkspaceUiStore = create<WorkspaceUiState>((set, get) => {
  const setWithPersistenceRevision: WorkspaceUiSet = (partial) => {
    set((state) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      if (next === state) {
        return state;
      }
      const candidate = { ...state, ...next };
      const persistedStateChanged = getChangedWorkspaceUiStateKeys(state, candidate)
        .some((key) => !isNonPersistedWorkspaceUiStateKey(key));
      return {
        ...next,
        _persistenceRevision: state._persistenceRevision + (persistedStateChanged ? 1 : 0),
      };
    });
  };

  return {
    ...WORKSPACE_UI_DEFAULTS,
    _hydrated: false,
    _persistenceRevision: 0,
    shellActivationEpochByWorkspace: {},
    pendingChatActivationByWorkspace: {},
    urgentHighlightedChatSessionByWorkspace: {},

    hydrate: (state) => {
      set({
        ...state,
        _hydrated: true,
      });
    },

    ...createWorkspaceUiSidebarActions(setWithPersistenceRevision, get),
    ...createWorkspaceUiRightPanelActions(setWithPersistenceRevision),
    ...createWorkspaceUiShellActions(setWithPersistenceRevision, get),
    ...createWorkspaceUiActivityActions(setWithPersistenceRevision, get),
    ...createWorkspaceUiDismissalActions(setWithPersistenceRevision, get),
    ...createWorkspaceUiChatTabActions(setWithPersistenceRevision, get),
    ...createWorkspaceUiGitStatusActions(setWithPersistenceRevision, get),
  };
});

export function trackWorkspaceInteraction(workspaceId: string, timestamp: string) {
  useWorkspaceUiStore.getState().updateWorkspaceLastInteracted(workspaceId, timestamp);
}

export function trackSessionInteraction(sessionId: string, timestamp: string) {
  useWorkspaceUiStore.getState().updateSessionLastInteracted(sessionId, timestamp);
}

export function markWorkspaceViewed(workspaceId: string) {
  useWorkspaceUiStore.getState().markWorkspaceViewed(workspaceId);
}

export function markWorkspaceViewedAt(workspaceId: string, timestamp: string) {
  useWorkspaceUiStore.getState().markWorkspaceViewedAt(workspaceId, timestamp);
}

export function rememberLastViewedSession(workspaceId: string, sessionId: string) {
  useWorkspaceUiStore.getState().setLastViewedSessionForWorkspace(workspaceId, sessionId);
}

export function clearLastViewedSession(workspaceId: string, sessionId?: string) {
  useWorkspaceUiStore.getState().clearLastViewedSessionForWorkspace(workspaceId, sessionId);
}

export function markSessionErrorViewed(sessionId: string, errorAt: string) {
  useWorkspaceUiStore.getState().markSessionErrorViewed(sessionId, errorAt);
}

export function clearViewedSessionErrors(sessionIds: string[]) {
  useWorkspaceUiStore.getState().clearViewedSessionErrors(sessionIds);
}

export function ensureRepoGroupExpanded(repoKey: string) {
  useWorkspaceUiStore.getState().ensureRepoGroupExpanded(repoKey);
}

export function recordWorkspaceGitStatusSnapshot(
  logicalWorkspaceId: string,
  snapshot: PersistedWorkspaceGitStatusSnapshot,
) {
  useWorkspaceUiStore.getState().recordWorkspaceGitStatusSnapshot(logicalWorkspaceId, snapshot);
}

export function stampWorkspaceGitPrompt(logicalWorkspaceId: string, at: string) {
  useWorkspaceUiStore.getState().stampWorkspaceGitPrompt(logicalWorkspaceId, at);
}

export function pruneWorkspaceGitStatusSnapshots(liveLogicalWorkspaceIds: string[]) {
  useWorkspaceUiStore.getState().pruneWorkspaceGitStatusSnapshots(liveLogicalWorkspaceIds);
}
