import { resolveSidebarWorkspaceTypes } from "@/lib/domain/workspaces/sidebar/sidebar-workspace-types";
import {
  isStringArrayRecord,
  isStringRecord,
  sanitizeLastViewedSessionByWorkspace,
  sanitizeManualChatGroupsWithoutTransientSessions,
  sanitizeSessionIdArrayRecord,
} from "@/lib/domain/preferences/workspace-ui/persisted-chat-sessions";
import {
  sanitizeGitStatusSnapshotsByWorkspace,
} from "@/lib/domain/preferences/workspace-ui/persisted-git-status";
import {
  migrateLegacyRightPanelPreferences,
  sanitizeRightPanelDurableByWorkspace,
  sanitizeRightPanelMaterializedByWorkspace,
} from "@/lib/domain/preferences/workspace-ui/persisted-right-panel";
import {
  sanitizeActiveShellTabKeysByWorkspace,
  sanitizeShellTabOrderByWorkspace,
} from "@/lib/domain/preferences/workspace-ui/persisted-shell-tabs";
import {
  WORKSPACE_UI_DEFAULTS,
  WORKSPACE_UI_MIGRATION_VERSION,
  type PersistedWorkspaceUiState,
} from "@/lib/domain/preferences/workspace-ui/model";
import { clampWorkspaceSidebarWidth } from "@/lib/domain/preferences/workspace-ui/sidebar";

export function migrateWorkspaceUiState(
  input: PersistedWorkspaceUiState,
): { state: PersistedWorkspaceUiState; didMigrate: boolean } {
  const legacyInput = input as PersistedWorkspaceUiState & {
    rightPanelByWorkspace?: Record<string, unknown>;
    rightPanelWidthByWorkspace?: Record<string, number>;
  };
  const state = {
    ...WORKSPACE_UI_DEFAULTS,
    ...input,
  };
  let didMigrate = false;
  const previousMigrationVersion = state.migrationVersion ?? 0;
  if (previousMigrationVersion < 7) {
    const migratedRightPanel = migrateLegacyRightPanelPreferences({
      rightPanelByWorkspace: legacyInput.rightPanelByWorkspace,
      rightPanelWidthByWorkspace: legacyInput.rightPanelWidthByWorkspace,
    });
    state.rightPanelDurableByWorkspace = {
      ...migratedRightPanel.durableByWorkspace,
      ...state.rightPanelDurableByWorkspace,
    };
    state.rightPanelMaterializedByWorkspace = {
      ...migratedRightPanel.materializedByWorkspace,
      ...state.rightPanelMaterializedByWorkspace,
    };
    didMigrate = true;
  }
  if (previousMigrationVersion < 3) {
    state.archivedWorkspaceIds = [];
    didMigrate = true;
  }
  if (previousMigrationVersion < 2) {
    state.lastViewedAt = {};
    state.lastViewedSessionByWorkspace = {};
    state.workspaceLastInteracted = {};
    didMigrate = true;
  }
  if (!isStringRecord(state.sessionLastInteracted)) {
    state.sessionLastInteracted = WORKSPACE_UI_DEFAULTS.sessionLastInteracted;
    didMigrate = true;
  }
  if (!isStringRecord(state.sessionLastViewedAt)) {
    state.sessionLastViewedAt = WORKSPACE_UI_DEFAULTS.sessionLastViewedAt;
    didMigrate = true;
  }
  if (previousMigrationVersion < WORKSPACE_UI_MIGRATION_VERSION) {
    state.migrationVersion = WORKSPACE_UI_MIGRATION_VERSION;
    didMigrate = true;
  }

  if (!Array.isArray(state.collapsedRepoGroups)) {
    const legacy = state.collapsedRepoGroups as unknown as Record<string, boolean>;
    state.collapsedRepoGroups = Object.keys(legacy).filter((k) => legacy[k]);
    didMigrate = true;
  }

  if (typeof state.sidebarOpen !== "boolean") {
    state.sidebarOpen = WORKSPACE_UI_DEFAULTS.sidebarOpen;
    didMigrate = true;
  }

  if (typeof state.showArchived !== "boolean") {
    state.showArchived = WORKSPACE_UI_DEFAULTS.showArchived;
    didMigrate = true;
  }

  if (typeof state.sidebarWidth !== "number" || Number.isNaN(state.sidebarWidth)) {
    state.sidebarWidth = WORKSPACE_UI_DEFAULTS.sidebarWidth;
    didMigrate = true;
  }

  const sanitizedRightPanelDurable = sanitizeRightPanelDurableByWorkspace(
    state.rightPanelDurableByWorkspace,
  );
  if (JSON.stringify(sanitizedRightPanelDurable) !== JSON.stringify(state.rightPanelDurableByWorkspace)) {
    state.rightPanelDurableByWorkspace = sanitizedRightPanelDurable;
    didMigrate = true;
  }

  const sanitizedRightPanelMaterialized = sanitizeRightPanelMaterializedByWorkspace(
    state.rightPanelMaterializedByWorkspace,
  );
  if (
    JSON.stringify(sanitizedRightPanelMaterialized)
    !== JSON.stringify(state.rightPanelMaterializedByWorkspace)
  ) {
    state.rightPanelMaterializedByWorkspace = sanitizedRightPanelMaterialized;
    didMigrate = true;
  }

  const sanitizedActiveShellTabs = sanitizeActiveShellTabKeysByWorkspace(
    state.activeShellTabKeyByWorkspace,
  );
  if (JSON.stringify(sanitizedActiveShellTabs) !== JSON.stringify(state.activeShellTabKeyByWorkspace)) {
    state.activeShellTabKeyByWorkspace = sanitizedActiveShellTabs;
    didMigrate = true;
  }

  const sanitizedShellOrder = sanitizeShellTabOrderByWorkspace(
    state.shellTabOrderByWorkspace,
  );
  if (JSON.stringify(sanitizedShellOrder) !== JSON.stringify(state.shellTabOrderByWorkspace)) {
    state.shellTabOrderByWorkspace = sanitizedShellOrder;
    didMigrate = true;
  }

  const sanitizedVisibleChatSessions = sanitizeSessionIdArrayRecord(
    state.visibleChatSessionIdsByWorkspace,
  );
  if (
    JSON.stringify(sanitizedVisibleChatSessions)
    !== JSON.stringify(state.visibleChatSessionIdsByWorkspace)
  ) {
    state.visibleChatSessionIdsByWorkspace = sanitizedVisibleChatSessions;
    didMigrate = true;
  }
  if (!isStringArrayRecord(state.visibleChatSessionIdsByWorkspace)) {
    state.visibleChatSessionIdsByWorkspace = WORKSPACE_UI_DEFAULTS.visibleChatSessionIdsByWorkspace;
    didMigrate = true;
  }

  if (!isStringRecord(state.lastViewedSessionErrorAtBySession)) {
    state.lastViewedSessionErrorAtBySession =
      WORKSPACE_UI_DEFAULTS.lastViewedSessionErrorAtBySession;
    didMigrate = true;
  }

  const sanitizedRecentlyHiddenChatSessions = sanitizeSessionIdArrayRecord(
    state.recentlyHiddenChatSessionIdsByWorkspace,
  );
  if (
    JSON.stringify(sanitizedRecentlyHiddenChatSessions)
    !== JSON.stringify(state.recentlyHiddenChatSessionIdsByWorkspace)
  ) {
    state.recentlyHiddenChatSessionIdsByWorkspace = sanitizedRecentlyHiddenChatSessions;
    didMigrate = true;
  }
  if (!isStringArrayRecord(state.recentlyHiddenChatSessionIdsByWorkspace)) {
    state.recentlyHiddenChatSessionIdsByWorkspace =
      WORKSPACE_UI_DEFAULTS.recentlyHiddenChatSessionIdsByWorkspace;
    didMigrate = true;
  }

  const sanitizedCollapsedChatGroups = sanitizeSessionIdArrayRecord(
    state.collapsedChatGroupsByWorkspace,
  );
  if (
    JSON.stringify(sanitizedCollapsedChatGroups)
    !== JSON.stringify(state.collapsedChatGroupsByWorkspace)
  ) {
    state.collapsedChatGroupsByWorkspace = sanitizedCollapsedChatGroups;
    didMigrate = true;
  }
  if (!isStringArrayRecord(state.collapsedChatGroupsByWorkspace)) {
    state.collapsedChatGroupsByWorkspace = WORKSPACE_UI_DEFAULTS.collapsedChatGroupsByWorkspace;
    didMigrate = true;
  }

  const sanitizedManualGroups = sanitizeManualChatGroupsWithoutTransientSessions(
    state.manualChatGroupsByWorkspace,
  );
  if (JSON.stringify(sanitizedManualGroups) !== JSON.stringify(state.manualChatGroupsByWorkspace)) {
    state.manualChatGroupsByWorkspace = sanitizedManualGroups;
    didMigrate = true;
  }

  const sanitizedLastViewedSessions = sanitizeLastViewedSessionByWorkspace(
    state.lastViewedSessionByWorkspace,
  );
  if (
    JSON.stringify(sanitizedLastViewedSessions)
    !== JSON.stringify(state.lastViewedSessionByWorkspace)
  ) {
    state.lastViewedSessionByWorkspace = sanitizedLastViewedSessions;
    didMigrate = true;
  }

  const sanitizedGitStatusSnapshots = sanitizeGitStatusSnapshotsByWorkspace(
    state.gitStatusSnapshotByWorkspace,
  );
  if (
    JSON.stringify(sanitizedGitStatusSnapshots)
    !== JSON.stringify(state.gitStatusSnapshotByWorkspace)
  ) {
    state.gitStatusSnapshotByWorkspace = sanitizedGitStatusSnapshots;
    didMigrate = true;
  }

  const clampedSidebarWidth = clampWorkspaceSidebarWidth(state.sidebarWidth);
  if (clampedSidebarWidth !== state.sidebarWidth) {
    state.sidebarWidth = clampedSidebarWidth;
    didMigrate = true;
  }

  const resolvedWorkspaceTypes = resolveSidebarWorkspaceTypes(state.workspaceTypes);
  if (
    resolvedWorkspaceTypes.length !== state.workspaceTypes.length
    || resolvedWorkspaceTypes.some((type, index) => type !== state.workspaceTypes[index])
  ) {
    state.workspaceTypes = resolvedWorkspaceTypes;
    didMigrate = true;
  }

  return { state, didMigrate };
}
