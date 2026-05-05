import type { SetStateAction } from "react";
import { create } from "zustand";
import {
  clearHiddenChatSessionIds,
  rememberHiddenChatSessionId,
  uniqueIds,
} from "@/lib/domain/workspaces/tabs/visibility";
import {
  deleteManualChatGroup,
  removeSessionsFromManualChatGroups,
  sanitizeManualChatGroupsByWorkspace,
  updateManualChatGroup,
  upsertManualChatGroup,
  type ManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
  resolveSidebarWorkspaceTypes,
  toggleSidebarWorkspaceTypeSelection,
  type SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar";
import {
  clampRightPanelWidth,
  DEFAULT_RIGHT_PANEL_DURABLE_STATE,
  DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE,
  normalizeRightPanelDurableState,
  normalizeRightPanelMaterializedState,
  reconcileRightPanelWorkspaceState,
  type RightPanelDurableState,
  type RightPanelMaterializedState,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/right-panel";
import { migrateLegacyRightPanelWorkspaceState } from "@/lib/domain/workspaces/right-panel-migration";
import type { PendingChatActivation } from "@/lib/domain/workspaces/tabs/shell-activation";
import type {
  WorkspaceShellIntentKey,
  WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  sanitizeWorkspaceShellTabKeys,
} from "@/lib/domain/workspaces/tabs/shell-file-seed";
import { sameStringArray } from "@/lib/domain/workspaces/workspace-keyed-preferences";
import { readPersistedValue, persistValue } from "@/lib/infra/preferences-persistence";
import {
  isDebugMeasurementEnabled,
  recordMeasurementDiagnostic,
} from "@/lib/infra/debug-measurement";

export interface WorkspaceUiState {
  _hydrated: boolean;
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
  shellActivationEpochByWorkspace: Record<string, number>;
  pendingChatActivationByWorkspace: Record<string, PendingChatActivation | null>;
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
  archiveWorkspace: (id: string) => void;
  archiveWorkspaces: (ids: string[]) => void;
  unarchiveWorkspace: (id: string) => void;
  unarchiveWorkspaces: (ids: string[]) => void;
  hideRepoRoot: (repoRootId: string) => void;
  unhideRepoRoot: (repoRootId: string) => void;
  toggleRepoGroupCollapsed: (repoKey: string) => void;
  ensureRepoGroupExpanded: (repoKey: string) => void;
  setCollapsedRepoGroups: (keys: string[]) => void;
  setShowArchived: (value: boolean) => void;
  setThreadsCollapsed: (value: boolean) => void;
  setSidebarOpen: (value: SetStateAction<boolean>) => void;
  setSidebarWidth: (value: SetStateAction<number>) => void;
  setRightPanelForWorkspace: (workspaceId: string, value: SetStateAction<RightPanelWorkspaceState>) => void;
  setRightPanelDurableForWorkspace: (
    workspaceId: string,
    value: SetStateAction<RightPanelDurableState>,
  ) => void;
  setRightPanelMaterializedForWorkspace: (
    workspaceId: string,
    value: SetStateAction<RightPanelMaterializedState>,
  ) => void;
  setRightPanelWidthForWorkspace: (
    workspaceId: string,
    value: SetStateAction<number>,
  ) => void;
  setRightPanelOpenForWorkspace: (
    workspaceId: string,
    value: SetStateAction<boolean>,
  ) => void;
  setActiveShellTabKeyForWorkspace: (
    workspaceId: string,
    key: WorkspaceShellIntentKey | null,
  ) => void;
  setShellTabOrderForWorkspace: (
    workspaceId: string,
    order: WorkspaceShellTabKey[],
  ) => void;
  writeShellIntent: (input: {
    workspaceId: string;
    intent: WorkspaceShellIntentKey | null;
  }) => ShellIntentResult;
  replaceShellIntent: (input: {
    workspaceId: string;
    expectedIntent: WorkspaceShellIntentKey | null;
    nextIntent: WorkspaceShellIntentKey | null;
    expectedEpoch?: number;
  }) => ShellIntentResult & { replaced: boolean };
  rollbackShellIntent: (input: {
    workspaceId: string;
    expectedIntent: WorkspaceShellIntentKey | null;
    expectedEpoch: number;
    expectedPendingAttemptId?: string;
    rollbackIntent: WorkspaceShellIntentKey | null;
  }) => ShellIntentResult & { rolledBack: boolean };
  setPendingChatActivation: (input: {
    workspaceId: string;
    pending: PendingChatActivation;
  }) => { set: true };
  clearPendingChatActivation: (input: {
    workspaceId: string;
    attemptId: string;
    bumpIfCurrent: boolean;
  }) => { cleared: boolean; bumped: boolean; epoch: number };
  resetWorkspaceShellTabs: (workspaceId: string) => void;
  toggleSidebarWorkspaceType: (type: SidebarWorkspaceVariant) => void;
  markWorkspaceViewed: (workspaceId: string) => void;
  markWorkspaceViewedAt: (workspaceId: string, timestamp: string) => void;
  setLastViewedSessionForWorkspace: (workspaceId: string, sessionId: string) => void;
  clearLastViewedSessionForWorkspace: (workspaceId: string, sessionId?: string) => void;
  markSessionErrorViewed: (sessionId: string, errorAt: string) => void;
  clearViewedSessionErrors: (sessionIds: string[]) => void;
  updateWorkspaceLastInteracted: (workspaceId: string, timestamp: string) => void;
  dismissSetupFailure: (workspaceId: string) => void;
  clearSetupFailureDismissal: (workspaceId: string) => void;
  dismissFinishSuggestion: (workspaceId: string, readinessFingerprint: string) => void;
  clearFinishSuggestionDismissal: (workspaceId: string) => void;
  setVisibleChatSessionIdsForWorkspace: (workspaceId: string, sessionIds: string[]) => void;
  rememberHiddenChatSessionForWorkspace: (workspaceId: string, sessionId: string) => void;
  clearHiddenChatSessionsForWorkspace: (workspaceId: string, sessionIds: string[]) => void;
  toggleChatGroupCollapsedForWorkspace: (workspaceId: string, parentSessionId: string) => void;
  clearChatGroupCollapsedForWorkspace: (workspaceId: string, parentSessionIds: string[]) => void;
  setManualChatGroupsForWorkspace: (workspaceId: string, groups: ManualChatGroup[]) => void;
  upsertManualChatGroupForWorkspace: (workspaceId: string, group: ManualChatGroup) => void;
  updateManualChatGroupForWorkspace: (
    workspaceId: string,
    groupId: string,
    updates: Partial<Pick<ManualChatGroup, "label" | "colorId">>,
  ) => void;
  deleteManualChatGroupForWorkspace: (workspaceId: string, groupId: string) => void;
  removeSessionsFromManualChatGroupsForWorkspace: (
    workspaceId: string,
    sessionIds: string[],
  ) => void;
  clearWorkspaceChatTabState: (workspaceId: string) => void;
}

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
 */
const WORKSPACE_UI_MIGRATION_VERSION = 8;
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

export interface ShellIntentResult {
  changed: boolean;
  previousIntent: WorkspaceShellIntentKey | null;
  currentIntent: WorkspaceShellIntentKey | null;
  epoch: number;
}

const WORKSPACE_UI_KEY = "workspace_ui";
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

function clampSidebarWidth(width: number): number {
  return Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, width));
}

function resolveStateValue<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === "function"
    ? (value as (previousValue: T) => T)(current)
    : value;
}

async function readAll(): Promise<{ state: PersistedWorkspaceUiState; didMigrate: boolean }> {
  let state: PersistedWorkspaceUiState;

  const persisted = await readPersistedValue<PersistedWorkspaceUiState>(WORKSPACE_UI_KEY);
  if (persisted) {
    state = {
      ...WORKSPACE_UI_DEFAULTS,
      ...persisted,
    };
  } else {
    state = {
      archivedWorkspaceIds:
        (await readPersistedValue<string[]>("archivedWorkspaceIds"))
        ?? WORKSPACE_UI_DEFAULTS.archivedWorkspaceIds,
      hiddenRepoRootIds: WORKSPACE_UI_DEFAULTS.hiddenRepoRootIds,
      sidebarOpen: WORKSPACE_UI_DEFAULTS.sidebarOpen,
      sidebarWidth: WORKSPACE_UI_DEFAULTS.sidebarWidth,
      rightPanelDurableByWorkspace: WORKSPACE_UI_DEFAULTS.rightPanelDurableByWorkspace,
      rightPanelMaterializedByWorkspace: WORKSPACE_UI_DEFAULTS.rightPanelMaterializedByWorkspace,
      activeShellTabKeyByWorkspace: WORKSPACE_UI_DEFAULTS.activeShellTabKeyByWorkspace,
      shellTabOrderByWorkspace: WORKSPACE_UI_DEFAULTS.shellTabOrderByWorkspace,
      workspaceTypes: WORKSPACE_UI_DEFAULTS.workspaceTypes,
      lastViewedAt:
        (await readPersistedValue<Record<string, string>>("lastViewedAt"))
        ?? WORKSPACE_UI_DEFAULTS.lastViewedAt,
      lastViewedSessionByWorkspace:
        (await readPersistedValue<Record<string, string>>("lastViewedSessionByWorkspace"))
        ?? WORKSPACE_UI_DEFAULTS.lastViewedSessionByWorkspace,
      lastViewedSessionErrorAtBySession:
        WORKSPACE_UI_DEFAULTS.lastViewedSessionErrorAtBySession,
      workspaceLastInteracted:
        (await readPersistedValue<Record<string, string>>("workspaceLastInteracted"))
        ?? WORKSPACE_UI_DEFAULTS.workspaceLastInteracted,
      collapsedRepoGroups: WORKSPACE_UI_DEFAULTS.collapsedRepoGroups,
      showArchived: WORKSPACE_UI_DEFAULTS.showArchived,
      threadsCollapsed: WORKSPACE_UI_DEFAULTS.threadsCollapsed,
      dismissedSetupFailures: WORKSPACE_UI_DEFAULTS.dismissedSetupFailures,
      finishSuggestionDismissalsByWorkspaceId:
        WORKSPACE_UI_DEFAULTS.finishSuggestionDismissalsByWorkspaceId,
      visibleChatSessionIdsByWorkspace: WORKSPACE_UI_DEFAULTS.visibleChatSessionIdsByWorkspace,
      recentlyHiddenChatSessionIdsByWorkspace:
        WORKSPACE_UI_DEFAULTS.recentlyHiddenChatSessionIdsByWorkspace,
      collapsedChatGroupsByWorkspace: WORKSPACE_UI_DEFAULTS.collapsedChatGroupsByWorkspace,
      manualChatGroupsByWorkspace: WORKSPACE_UI_DEFAULTS.manualChatGroupsByWorkspace,
    };
  }

  return migrateWorkspaceUiState(state);
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

  // Migrate collapsedRepoGroups from Record<string, boolean> to string[]
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

  if (!isStringArrayRecord(state.recentlyHiddenChatSessionIdsByWorkspace)) {
    state.recentlyHiddenChatSessionIdsByWorkspace =
      WORKSPACE_UI_DEFAULTS.recentlyHiddenChatSessionIdsByWorkspace;
    didMigrate = true;
  }

  if (!isStringArrayRecord(state.collapsedChatGroupsByWorkspace)) {
    state.collapsedChatGroupsByWorkspace = WORKSPACE_UI_DEFAULTS.collapsedChatGroupsByWorkspace;
    didMigrate = true;
  }

  const sanitizedManualGroups = sanitizeManualChatGroupsByWorkspace(
    state.manualChatGroupsByWorkspace,
  );
  if (JSON.stringify(sanitizedManualGroups) !== JSON.stringify(state.manualChatGroupsByWorkspace)) {
    state.manualChatGroupsByWorkspace = sanitizedManualGroups;
    didMigrate = true;
  }

  const clampedSidebarWidth = clampSidebarWidth(state.sidebarWidth);
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

function selectPersistedSlice(state: WorkspaceUiState): PersistedWorkspaceUiState {
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
    activeShellTabKeyByWorkspace: state.activeShellTabKeyByWorkspace,
    shellTabOrderByWorkspace: state.shellTabOrderByWorkspace,
    workspaceTypes: state.workspaceTypes,
    lastViewedAt: state.lastViewedAt,
    lastViewedSessionByWorkspace: state.lastViewedSessionByWorkspace,
    lastViewedSessionErrorAtBySession: state.lastViewedSessionErrorAtBySession,
    workspaceLastInteracted: state.workspaceLastInteracted,
    dismissedSetupFailures: state.dismissedSetupFailures,
    finishSuggestionDismissalsByWorkspaceId: state.finishSuggestionDismissalsByWorkspaceId,
    visibleChatSessionIdsByWorkspace: state.visibleChatSessionIdsByWorkspace,
    recentlyHiddenChatSessionIdsByWorkspace: state.recentlyHiddenChatSessionIdsByWorkspace,
    collapsedChatGroupsByWorkspace: state.collapsedChatGroupsByWorkspace,
    manualChatGroupsByWorkspace: state.manualChatGroupsByWorkspace,
  };
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
    if (typeof key === "string" && sanitizeWorkspaceShellTabKeys([key]).length === 1) {
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
    const sanitized = sanitizeWorkspaceShellTabKeys(order);
    if (sanitized.length > 0) {
      next[workspaceId] = sanitized;
    }
  }
  return next;
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

function rightPanelStateUpdate(
  state: WorkspaceUiState,
  workspaceId: string,
  value: SetStateAction<RightPanelWorkspaceState>,
): Pick<WorkspaceUiState, "rightPanelMaterializedByWorkspace"> {
  const currentMaterialized = state.rightPanelMaterializedByWorkspace[workspaceId]
    ?? DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE;
  const nextMaterialized = reconcileRightPanelWorkspaceState(
    resolveStateValue(value, currentMaterialized),
    { isCloudWorkspaceSelected: true },
  );

  return {
    rightPanelMaterializedByWorkspace: {
      ...state.rightPanelMaterializedByWorkspace,
      [workspaceId]: nextMaterialized,
    },
  };
}

export const useWorkspaceUiStore = create<WorkspaceUiState>((set, get) => ({
  ...WORKSPACE_UI_DEFAULTS,
  _hydrated: false,
  shellActivationEpochByWorkspace: {},
  pendingChatActivationByWorkspace: {},

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

  hideRepoRoot: (repoRootId) => {
    const current = get().hiddenRepoRootIds;
    if (current.includes(repoRootId)) {
      return;
    }
    set({ hiddenRepoRootIds: [...current, repoRootId] });
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
      sidebarWidth: clampSidebarWidth(resolveStateValue(value, state.sidebarWidth)),
    }));
  },

  setRightPanelForWorkspace: (workspaceId, value) => {
    set((state) => ({
      ...rightPanelStateUpdate(state, workspaceId, value),
    }));
  },

  setRightPanelDurableForWorkspace: (workspaceId, value) => {
    set((state) => ({
      rightPanelDurableByWorkspace: {
        ...state.rightPanelDurableByWorkspace,
        [workspaceId]: normalizeRightPanelDurableState(
          resolveStateValue(
            value,
            state.rightPanelDurableByWorkspace[workspaceId] ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE,
          ),
        ),
      },
    }));
  },

  setRightPanelMaterializedForWorkspace: (workspaceId, value) => {
    set((state) => ({
      rightPanelMaterializedByWorkspace: {
        ...state.rightPanelMaterializedByWorkspace,
        [workspaceId]: reconcileRightPanelWorkspaceState(
          resolveStateValue(
            value,
            state.rightPanelMaterializedByWorkspace[workspaceId]
              ?? DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE,
          ),
          { isCloudWorkspaceSelected: true },
        ),
      },
    }));
  },

  setRightPanelWidthForWorkspace: (workspaceId, value) => {
    set((state) => {
      const current = state.rightPanelDurableByWorkspace[workspaceId]
        ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE;
      return {
        rightPanelDurableByWorkspace: {
          ...state.rightPanelDurableByWorkspace,
          [workspaceId]: {
            ...current,
            width: clampRightPanelWidth(resolveStateValue(value, current.width)),
          },
        },
      };
    });
  },

  setRightPanelOpenForWorkspace: (workspaceId, value) => {
    set((state) => {
      const current = state.rightPanelDurableByWorkspace[workspaceId]
        ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE;
      return {
        rightPanelDurableByWorkspace: {
          ...state.rightPanelDurableByWorkspace,
          [workspaceId]: {
            ...current,
            open: resolveStateValue(value, current.open),
          },
        },
      };
    });
  },

  setActiveShellTabKeyForWorkspace: (workspaceId, key) => {
    get().writeShellIntent({ workspaceId, intent: key });
  },

  writeShellIntent: ({ workspaceId, intent }) => {
    const hasCurrent = Object.prototype.hasOwnProperty.call(
      get().activeShellTabKeyByWorkspace,
      workspaceId,
    );
    const current = hasCurrent ? get().activeShellTabKeyByWorkspace[workspaceId] : null;
    const previousEpoch = get().shellActivationEpochByWorkspace[workspaceId] ?? 0;
    if (hasCurrent && current === intent) {
      return {
        changed: false,
        previousIntent: current,
        currentIntent: current,
        epoch: previousEpoch,
      };
    }
    const nextEpoch = previousEpoch + 1;
    set({
      activeShellTabKeyByWorkspace: {
        ...get().activeShellTabKeyByWorkspace,
        [workspaceId]: intent,
      },
      shellActivationEpochByWorkspace: {
        ...get().shellActivationEpochByWorkspace,
        [workspaceId]: nextEpoch,
      },
    });
    return {
      changed: true,
      previousIntent: current,
      currentIntent: intent,
      epoch: nextEpoch,
    };
  },

  replaceShellIntent: ({ workspaceId, expectedIntent, nextIntent, expectedEpoch }) => {
    const previousIntent = get().activeShellTabKeyByWorkspace[workspaceId] ?? null;
    const previousEpoch = get().shellActivationEpochByWorkspace[workspaceId] ?? 0;
    if (
      previousIntent !== expectedIntent
      || (expectedEpoch !== undefined && previousEpoch !== expectedEpoch)
    ) {
      return {
        changed: false,
        replaced: false,
        previousIntent,
        currentIntent: previousIntent,
        epoch: previousEpoch,
      };
    }
    const result = get().writeShellIntent({ workspaceId, intent: nextIntent });
    return { ...result, replaced: result.changed };
  },

  rollbackShellIntent: ({
    workspaceId,
    expectedIntent,
    expectedEpoch,
    expectedPendingAttemptId,
    rollbackIntent,
  }) => {
    const previousIntent = get().activeShellTabKeyByWorkspace[workspaceId] ?? null;
    const previousEpoch = get().shellActivationEpochByWorkspace[workspaceId] ?? 0;
    const pending = get().pendingChatActivationByWorkspace[workspaceId] ?? null;
    if (
      previousIntent !== expectedIntent
      || previousEpoch !== expectedEpoch
      || (
        expectedPendingAttemptId !== undefined
        && pending?.attemptId !== expectedPendingAttemptId
      )
    ) {
      return {
        changed: false,
        rolledBack: false,
        previousIntent,
        currentIntent: previousIntent,
        epoch: previousEpoch,
      };
    }
    const result = get().writeShellIntent({ workspaceId, intent: rollbackIntent });
    return { ...result, rolledBack: result.changed };
  },

  setPendingChatActivation: ({ workspaceId, pending }) => {
    set({
      pendingChatActivationByWorkspace: {
        ...get().pendingChatActivationByWorkspace,
        [workspaceId]: pending,
      },
    });
    return { set: true };
  },

  clearPendingChatActivation: ({ workspaceId, attemptId, bumpIfCurrent }) => {
    const pending = get().pendingChatActivationByWorkspace[workspaceId] ?? null;
    const epoch = get().shellActivationEpochByWorkspace[workspaceId] ?? 0;
    if (!pending || pending.attemptId !== attemptId) {
      return { cleared: false, bumped: false, epoch };
    }
    const nextEpoch = bumpIfCurrent ? epoch + 1 : epoch;
    set({
      pendingChatActivationByWorkspace: {
        ...get().pendingChatActivationByWorkspace,
        [workspaceId]: null,
      },
      shellActivationEpochByWorkspace: bumpIfCurrent
        ? {
          ...get().shellActivationEpochByWorkspace,
          [workspaceId]: nextEpoch,
        }
        : get().shellActivationEpochByWorkspace,
    });
    return { cleared: true, bumped: bumpIfCurrent, epoch: nextEpoch };
  },

  setShellTabOrderForWorkspace: (workspaceId, order) => {
    const hasCurrent = Object.prototype.hasOwnProperty.call(
      get().shellTabOrderByWorkspace,
      workspaceId,
    );
    const current = hasCurrent ? get().shellTabOrderByWorkspace[workspaceId] : [];
    if (hasCurrent && sameStringArray(current, order)) {
      return;
    }
    set({
      shellTabOrderByWorkspace: {
        ...get().shellTabOrderByWorkspace,
        [workspaceId]: order,
      },
    });
  },

  resetWorkspaceShellTabs: (workspaceId) => {
    const active = { ...get().activeShellTabKeyByWorkspace };
    const order = { ...get().shellTabOrderByWorkspace };
    const epoch = { ...get().shellActivationEpochByWorkspace };
    const pending = { ...get().pendingChatActivationByWorkspace };
    delete active[workspaceId];
    delete order[workspaceId];
    delete epoch[workspaceId];
    delete pending[workspaceId];
    set({
      activeShellTabKeyByWorkspace: active,
      shellTabOrderByWorkspace: order,
      shellActivationEpochByWorkspace: epoch,
      pendingChatActivationByWorkspace: pending,
    });
  },

  toggleSidebarWorkspaceType: (type) => {
    set((state) => ({
      workspaceTypes: toggleSidebarWorkspaceTypeSelection(state.workspaceTypes, type),
    }));
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

  unhideRepoRoot: (repoRootId) => {
    const current = get().hiddenRepoRootIds;
    const next = current.filter((id) => id !== repoRootId);
    if (next.length === current.length) {
      return;
    }
    set({ hiddenRepoRootIds: next });
  },

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

  dismissSetupFailure: (workspaceId) => {
    set({
      dismissedSetupFailures: {
        ...get().dismissedSetupFailures,
        [workspaceId]: true,
      },
    });
  },

  clearSetupFailureDismissal: (workspaceId) => {
    const current = { ...get().dismissedSetupFailures };
    delete current[workspaceId];
    set({ dismissedSetupFailures: current });
  },

  dismissFinishSuggestion: (workspaceId, readinessFingerprint) => {
    set({
      finishSuggestionDismissalsByWorkspaceId: {
        ...get().finishSuggestionDismissalsByWorkspaceId,
        [workspaceId]: readinessFingerprint,
      },
    });
  },

  clearFinishSuggestionDismissal: (workspaceId) => {
    const current = { ...get().finishSuggestionDismissalsByWorkspaceId };
    delete current[workspaceId];
    set({ finishSuggestionDismissalsByWorkspaceId: current });
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
}));

useWorkspaceUiStore.subscribe((state, prev) => {
  if (isDebugMeasurementEnabled()) {
    const changedKeys = getChangedWorkspaceUiStateKeys(prev, state);
    if (changedKeys.length > 0) {
      recordMeasurementDiagnostic({
        category: "workspace_ui_store.write",
        label: "top_level_keys",
        keys: changedKeys,
        count: changedKeys.length,
      });
    }
  }

  if (!state._hydrated) {
    return;
  }

  const currentSlice = selectPersistedSlice(state);
  const previousSlice = selectPersistedSlice(prev);
  if (JSON.stringify(currentSlice) !== JSON.stringify(previousSlice)) {
    void persistValue(WORKSPACE_UI_KEY, currentSlice);
  }
});

export async function bootstrapWorkspaceUi(): Promise<void> {
  const { state, didMigrate } = await readAll();
  useWorkspaceUiStore.setState({
    ...state,
    _hydrated: true,
  });
  if (didMigrate) {
    // Force-persist so migrationVersion is saved even when the migration
    // itself was a no-op (e.g. workspaceLastInteracted was already empty).
    void persistValue(WORKSPACE_UI_KEY, selectPersistedSlice(useWorkspaceUiStore.getState()));
  }
}

export function trackWorkspaceInteraction(workspaceId: string, timestamp: string) {
  useWorkspaceUiStore.getState().updateWorkspaceLastInteracted(workspaceId, timestamp);
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

function getChangedWorkspaceUiStateKeys(
  previous: WorkspaceUiState,
  next: WorkspaceUiState,
): string[] {
  // Manual top-level allowlist for debug diagnostics. Keep this in sync when
  // adding workspace UI state that should show up in store-write traces.
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
    previous[key as keyof WorkspaceUiState],
    next[key as keyof WorkspaceUiState],
  ));
}
