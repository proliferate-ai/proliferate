import { create } from "zustand";
import { WORKSPACE_UI_DEFAULTS } from "@/lib/domain/preferences/workspace-ui/model";
import { createWorkspaceUiActivityActions } from "@/stores/preferences/workspace-ui-activity-actions";
import { createWorkspaceUiChatTabActions } from "@/stores/preferences/workspace-ui-chat-tab-actions";
import { createWorkspaceUiDismissalActions } from "@/stores/preferences/workspace-ui-dismissal-actions";
import { createWorkspaceUiRightPanelActions } from "@/stores/preferences/workspace-ui-right-panel-actions";
import { createWorkspaceUiShellActions } from "@/stores/preferences/workspace-ui-shell-actions";
import { createWorkspaceUiSidebarActions } from "@/stores/preferences/workspace-ui-sidebar-actions";
import type { WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

export type { ShellIntentResult, WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

export const useWorkspaceUiStore = create<WorkspaceUiState>((set, get) => ({
  ...WORKSPACE_UI_DEFAULTS,
  _hydrated: false,
  shellActivationEpochByWorkspace: {},
  pendingChatActivationByWorkspace: {},
  urgentHighlightedChatSessionByWorkspace: {},

  hydrate: (state) => {
    set({
      ...state,
      _hydrated: true,
    });
  },

  ...createWorkspaceUiSidebarActions(set, get),
  ...createWorkspaceUiRightPanelActions(set),
  ...createWorkspaceUiShellActions(set, get),
  ...createWorkspaceUiActivityActions(set, get),
  ...createWorkspaceUiDismissalActions(set, get),
  ...createWorkspaceUiChatTabActions(set, get),
}));

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

export function markSessionViewedAt(sessionId: string, timestamp: string) {
  useWorkspaceUiStore.getState().markSessionViewedAt(sessionId, timestamp);
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
