import {
  sanitizeLastViewedSessionByWorkspace,
  sanitizeManualChatGroupsWithoutTransientSessions,
  sanitizeSessionIdArrayRecord,
} from "@/lib/domain/preferences/workspace-ui/persisted-chat-sessions";
import {
  sanitizeActiveShellTabKeysByWorkspace,
  sanitizeShellTabOrderByWorkspace,
} from "@/lib/domain/preferences/workspace-ui/persisted-shell-tabs";
import {
  WORKSPACE_UI_MIGRATION_VERSION,
  type PersistedWorkspaceUiState,
  type WorkspaceUiChangeTrackedState,
} from "@/lib/domain/preferences/workspace-ui/model";

export function selectPersistedWorkspaceUiState(
  state: PersistedWorkspaceUiState,
): PersistedWorkspaceUiState {
  return {
    migrationVersion: WORKSPACE_UI_MIGRATION_VERSION,
    archivedWorkspaceIds: state.archivedWorkspaceIds,
    hiddenRepoRootIds: state.hiddenRepoRootIds,
    collapsedRepoGroups: state.collapsedRepoGroups,
    showArchived: state.showArchived,
    threadsCollapsed: state.threadsCollapsed,
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    rightPanelDurableByWorkspace: state.rightPanelDurableByWorkspace,
    rightPanelMaterializedByWorkspace: state.rightPanelMaterializedByWorkspace,
    activeShellTabKeyByWorkspace: sanitizeActiveShellTabKeysByWorkspace(
      state.activeShellTabKeyByWorkspace,
    ),
    shellTabOrderByWorkspace: sanitizeShellTabOrderByWorkspace(
      state.shellTabOrderByWorkspace,
    ),
    workspaceTypes: state.workspaceTypes,
    lastViewedAt: state.lastViewedAt,
    lastViewedSessionByWorkspace: sanitizeLastViewedSessionByWorkspace(
      state.lastViewedSessionByWorkspace,
    ),
    lastViewedSessionErrorAtBySession: state.lastViewedSessionErrorAtBySession,
    workspaceLastInteracted: state.workspaceLastInteracted,
    sessionLastInteracted: state.sessionLastInteracted,
    sessionLastViewedAt: state.sessionLastViewedAt,
    dismissedSetupFailures: state.dismissedSetupFailures,
    visibleChatSessionIdsByWorkspace: sanitizeSessionIdArrayRecord(
      state.visibleChatSessionIdsByWorkspace,
    ),
    recentlyHiddenChatSessionIdsByWorkspace: sanitizeSessionIdArrayRecord(
      state.recentlyHiddenChatSessionIdsByWorkspace,
    ),
    collapsedChatGroupsByWorkspace: sanitizeSessionIdArrayRecord(
      state.collapsedChatGroupsByWorkspace,
    ),
    manualChatGroupsByWorkspace: sanitizeManualChatGroupsWithoutTransientSessions(
      state.manualChatGroupsByWorkspace,
    ),
  };
}

export function getChangedWorkspaceUiStateKeys(
  previous: WorkspaceUiChangeTrackedState,
  next: WorkspaceUiChangeTrackedState,
): string[] {
  return [
    "archivedWorkspaceIds",
    "hiddenRepoRootIds",
    "collapsedRepoGroups",
    "showArchived",
    "threadsCollapsed",
    "sidebarOpen",
    "sidebarWidth",
    "rightPanelDurableByWorkspace",
    "rightPanelMaterializedByWorkspace",
    "activeShellTabKeyByWorkspace",
    "shellTabOrderByWorkspace",
    "shellActivationEpochByWorkspace",
    "pendingChatActivationByWorkspace",
    "urgentHighlightedChatSessionByWorkspace",
    "workspaceTypes",
    "lastViewedAt",
    "lastViewedSessionByWorkspace",
    "lastViewedSessionErrorAtBySession",
    "workspaceLastInteracted",
    "sessionLastInteracted",
    "sessionLastViewedAt",
    "dismissedSetupFailures",
    "visibleChatSessionIdsByWorkspace",
    "recentlyHiddenChatSessionIdsByWorkspace",
    "collapsedChatGroupsByWorkspace",
    "manualChatGroupsByWorkspace",
  ].filter((key) => !Object.is(
    previous[key as keyof WorkspaceUiChangeTrackedState],
    next[key as keyof WorkspaceUiChangeTrackedState],
  ));
}

export function isNonPersistedWorkspaceUiStateKey(key: string): boolean {
  return key === "pendingChatActivationByWorkspace"
    || key === "shellActivationEpochByWorkspace"
    || key === "urgentHighlightedChatSessionByWorkspace";
}
