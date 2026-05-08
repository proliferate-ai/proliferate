import {
  uniqueIds,
} from "@/lib/domain/workspaces/tabs/visibility";
import {
  sanitizeManualChatGroupsByWorkspace,
  type ManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
  resolveSidebarWorkspaceTypes,
  type SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar/sidebar";
import {
  clampRightPanelWidth,
  normalizeRightPanelDurableState,
  normalizeRightPanelMaterializedState,
  type RightPanelDurableState,
  type RightPanelMaterializedState,
} from "@/lib/domain/workspaces/shell/right-panel";
import { migrateLegacyRightPanelWorkspaceState } from "@/lib/domain/workspaces/shell/right-panel-migration";
import {
  parseWorkspaceShellTabKey,
  type WorkspaceShellIntentKey,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  sanitizeWorkspaceShellTabKeys,
} from "@/lib/domain/workspaces/tabs/shell-file-seed";

/**
 * We have not launched yet, so persisted workspace UI state is allowed to
 * reset across identity-model changes.
 * v1: reset false-unread state caused by wall-clock interaction timestamps.
 * v2: reset user-facing workspace-keyed state for logical-workspace cutover.
 * v3: reset archived workspace ids after removing repositories stopped
 * polluting the archive model.
 * v4: add workspace-scoped right-panel preferences.
 * v5: add unified right-panel header order hints.
 * v6: current mainline schema with legacy unified right-panel preferences.
 * v7: split right-panel durable/materialized state and persist shell tab maps.
 * v8: make activeEntryKey/headerOrder the only right-panel selection/order
 *     model, removing durable toolOrder and terminal active/order fields.
 * v9: drop transient projected chat session ids from persisted workspace UI
 *     state; materialized last-viewed session ids own restart restore.
 */
export const WORKSPACE_UI_MIGRATION_VERSION = 9;
export const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 280;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 220;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 420;

export interface PersistedWorkspaceUiState {
  migrationVersion?: number;
  archivedWorkspaceIds: string[];
  hiddenRepoRootIds: string[];
  collapsedRepoGroups: string[];
  showArchived: boolean;
  threadsCollapsed: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightPanelDurableByWorkspace: Record<string, RightPanelDurableState>;
  rightPanelMaterializedByWorkspace: Record<string, RightPanelMaterializedState>;
  activeShellTabKeyByWorkspace: Record<string, WorkspaceShellIntentKey | null>;
  shellTabOrderByWorkspace: Record<string, WorkspaceShellTabKey[]>;
  workspaceTypes: SidebarWorkspaceVariant[];
  lastViewedAt: Record<string, string>;
  lastViewedSessionByWorkspace: Record<string, string>;
  lastViewedSessionErrorAtBySession: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  dismissedSetupFailures: Record<string, boolean>;
  finishSuggestionDismissalsByWorkspaceId: Record<string, string>;
  visibleChatSessionIdsByWorkspace: Record<string, string[]>;
  recentlyHiddenChatSessionIdsByWorkspace: Record<string, string[]>;
  collapsedChatGroupsByWorkspace: Record<string, string[]>;
  manualChatGroupsByWorkspace: Record<string, ManualChatGroup[]>;
}

export interface WorkspaceUiChangeTrackedState extends PersistedWorkspaceUiState {
  shellActivationEpochByWorkspace: Record<string, number>;
  pendingChatActivationByWorkspace: Record<string, unknown>;
  urgentHighlightedChatSessionByWorkspace: Record<string, string | null>;
}

export const WORKSPACE_UI_DEFAULTS: PersistedWorkspaceUiState = {
  archivedWorkspaceIds: [],
  hiddenRepoRootIds: [],
  collapsedRepoGroups: [],
  showArchived: false,
  threadsCollapsed: false,
  sidebarOpen: false,
  sidebarWidth: WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
  rightPanelDurableByWorkspace: {},
  rightPanelMaterializedByWorkspace: {},
  activeShellTabKeyByWorkspace: {},
  shellTabOrderByWorkspace: {},
  workspaceTypes: DEFAULT_SIDEBAR_WORKSPACE_TYPES,
  lastViewedAt: {},
  lastViewedSessionByWorkspace: {},
  lastViewedSessionErrorAtBySession: {},
  workspaceLastInteracted: {},
  dismissedSetupFailures: {},
  finishSuggestionDismissalsByWorkspaceId: {},
  visibleChatSessionIdsByWorkspace: {},
  recentlyHiddenChatSessionIdsByWorkspace: {},
  collapsedChatGroupsByWorkspace: {},
  manualChatGroupsByWorkspace: {},
};

export function clampWorkspaceSidebarWidth(width: number): number {
  return Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, width));
}

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

  if (!isStringRecord(state.finishSuggestionDismissalsByWorkspaceId)) {
    state.finishSuggestionDismissalsByWorkspaceId =
      WORKSPACE_UI_DEFAULTS.finishSuggestionDismissalsByWorkspaceId;
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
    sanitizeManualChatGroupsByWorkspace(state.manualChatGroupsByWorkspace),
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
    dismissedSetupFailures: state.dismissedSetupFailures,
    finishSuggestionDismissalsByWorkspaceId: state.finishSuggestionDismissalsByWorkspaceId,
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
      sanitizeManualChatGroupsByWorkspace(state.manualChatGroupsByWorkspace),
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
    "dismissedSetupFailures",
    "finishSuggestionDismissalsByWorkspaceId",
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

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return typeof value === "object"
    && value !== null
    && Object.values(value).every((entry) =>
      Array.isArray(entry) && entry.every((item) => typeof item === "string")
    );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object"
    && value !== null
    && Object.values(value).every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function migrateLegacyRightPanelPreferences(args: {
  rightPanelByWorkspace?: Record<string, unknown>;
  rightPanelWidthByWorkspace?: Record<string, number>;
}): {
  durableByWorkspace: Record<string, RightPanelDurableState>;
  materializedByWorkspace: Record<string, RightPanelMaterializedState>;
} {
  const legacyPanels = isRecord(args.rightPanelByWorkspace) ? args.rightPanelByWorkspace : {};
  const legacyWidths = sanitizeRightPanelWidths(args.rightPanelWidthByWorkspace);
  const workspaceIds = new Set([
    ...Object.keys(legacyPanels),
    ...Object.keys(legacyWidths),
  ]);
  const durableByWorkspace: Record<string, RightPanelDurableState> = {};
  const materializedByWorkspace: Record<string, RightPanelMaterializedState> = {};

  for (const workspaceId of workspaceIds) {
    const legacyState = legacyPanels[workspaceId];
    if (!isRecord(legacyState) && legacyWidths[workspaceId] === undefined) {
      continue;
    }
    const { durableState, materializedState } = migrateLegacyRightPanelWorkspaceState({
      state: legacyState,
      width: legacyWidths[workspaceId],
      isCloudWorkspaceSelected: true,
    });
    durableByWorkspace[workspaceId] = durableState;
    materializedByWorkspace[workspaceId] = materializedState;
  }

  return { durableByWorkspace, materializedByWorkspace };
}

function sanitizeRightPanelDurableByWorkspace(
  value: unknown,
): Record<string, RightPanelDurableState> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const next: Record<string, RightPanelDurableState> = {};
  for (const [workspaceId, rawState] of Object.entries(value)) {
    if (typeof rawState !== "object" || rawState === null) {
      continue;
    }
    next[workspaceId] = normalizeRightPanelDurableState(
      rawState as Partial<RightPanelDurableState>,
    );
  }
  return next;
}

function sanitizeRightPanelMaterializedByWorkspace(
  value: unknown,
): Record<string, RightPanelMaterializedState> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const next: Record<string, RightPanelMaterializedState> = {};
  for (const [workspaceId, rawState] of Object.entries(value)) {
    if (typeof rawState !== "object" || rawState === null) {
      continue;
    }
    next[workspaceId] = normalizeRightPanelMaterializedState(
      rawState as Partial<RightPanelMaterializedState>,
      { isCloudWorkspaceSelected: true },
    );
  }
  return next;
}

function sanitizeActiveShellTabKeysByWorkspace(
  value: unknown,
): Record<string, WorkspaceShellIntentKey | null> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const next: Record<string, WorkspaceShellIntentKey | null> = {};
  for (const [workspaceId, key] of Object.entries(value)) {
    if (key === null) {
      next[workspaceId] = null;
      continue;
    }
    if (key === "chat-shell") {
      next[workspaceId] = key;
      continue;
    }
    if (
      typeof key === "string"
      && sanitizeWorkspaceShellTabKeys([key]).length === 1
      && !isTransientChatTabKey(key)
    ) {
      next[workspaceId] = key;
    }
  }
  return next;
}

function sanitizeShellTabOrderByWorkspace(
  value: unknown,
): Record<string, WorkspaceShellTabKey[]> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const next: Record<string, WorkspaceShellTabKey[]> = {};
  for (const [workspaceId, order] of Object.entries(value)) {
    if (!Array.isArray(order)) {
      continue;
    }
    const sanitized = sanitizeWorkspaceShellTabKeys(order)
      .filter((key) => !isTransientChatTabKey(key));
    if (sanitized.length > 0) {
      next[workspaceId] = sanitized;
    }
  }
  return next;
}

function sanitizeSessionIdArrayRecord(value: unknown): Record<string, string[]> {
  if (!isStringArrayRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([workspaceId, sessionIds]) => {
      const sanitized = uniqueIds(sessionIds.filter((sessionId) =>
        !isTransientClientSessionId(sessionId)
      ));
      return sanitized.length > 0 ? [[workspaceId, sanitized]] : [];
    }),
  );
}

function sanitizeLastViewedSessionByWorkspace(value: unknown): Record<string, string> {
  if (!isStringRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, sessionId]) => !isTransientClientSessionId(sessionId)),
  );
}

function sanitizeManualChatGroupsWithoutTransientSessions(
  value: Record<string, ManualChatGroup[]>,
): Record<string, ManualChatGroup[]> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([workspaceId, groups]) => {
      const nextGroups = groups.flatMap((group) => {
        const sessionIds = uniqueIds(group.sessionIds.filter((sessionId) =>
          !isTransientClientSessionId(sessionId)
        ));
        return sessionIds.length > 0 ? [{ ...group, sessionIds }] : [];
      });
      return nextGroups.length > 0 ? [[workspaceId, nextGroups]] : [];
    }),
  );
}

function isTransientChatTabKey(key: string): boolean {
  const parsed = parseWorkspaceShellTabKey(key);
  return parsed?.kind === "chat" && isTransientClientSessionId(parsed.sessionId);
}

function isTransientClientSessionId(sessionId: string): boolean {
  return sessionId.startsWith("client-session:")
    || sessionId.startsWith("pending-session:");
}

function sanitizeRightPanelWidths(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const next: Record<string, number> = {};
  for (const [workspaceId, width] of Object.entries(value)) {
    if (typeof width === "number" && Number.isFinite(width)) {
      next[workspaceId] = clampRightPanelWidth(width);
    }
  }
  return next;
}
