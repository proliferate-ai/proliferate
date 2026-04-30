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
import { readPersistedValue, persistValue } from "@/lib/infra/preferences-persistence";

export interface WorkspaceUiState {
  _hydrated: boolean;
  archivedWorkspaceIds: string[];
  hiddenRepoRootIds: string[];
  collapsedRepoGroups: string[];
  threadsCollapsed: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  workspaceTypes: SidebarWorkspaceVariant[];
  lastViewedAt: Record<string, string>;
  lastViewedSessionByWorkspace: Record<string, string>;
  lastViewedSessionErrorAtBySession: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  dismissedSetupFailures: Record<string, boolean>;
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
  setThreadsCollapsed: (value: boolean) => void;
  setSidebarOpen: (value: SetStateAction<boolean>) => void;
  setSidebarWidth: (value: SetStateAction<number>) => void;
  toggleSidebarWorkspaceType: (type: SidebarWorkspaceVariant) => void;
  markWorkspaceViewed: (workspaceId: string) => void;
  setLastViewedSessionForWorkspace: (workspaceId: string, sessionId: string) => void;
  clearLastViewedSessionForWorkspace: (workspaceId: string, sessionId?: string) => void;
  markSessionErrorViewed: (sessionId: string, errorAt: string) => void;
  clearViewedSessionErrors: (sessionIds: string[]) => void;
  updateWorkspaceLastInteracted: (workspaceId: string, timestamp: string) => void;
  dismissSetupFailure: (workspaceId: string) => void;
  clearSetupFailureDismissal: (workspaceId: string) => void;
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
 */
const WORKSPACE_UI_MIGRATION_VERSION = 3;
export const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 280;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 220;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 420;

export interface PersistedWorkspaceUiState {
  migrationVersion?: number;
  archivedWorkspaceIds: string[];
  hiddenRepoRootIds: string[];
  collapsedRepoGroups: string[];
  threadsCollapsed: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  workspaceTypes: SidebarWorkspaceVariant[];
  lastViewedAt: Record<string, string>;
  lastViewedSessionByWorkspace: Record<string, string>;
  lastViewedSessionErrorAtBySession: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  dismissedSetupFailures: Record<string, boolean>;
  visibleChatSessionIdsByWorkspace: Record<string, string[]>;
  recentlyHiddenChatSessionIdsByWorkspace: Record<string, string[]>;
  collapsedChatGroupsByWorkspace: Record<string, string[]>;
  manualChatGroupsByWorkspace: Record<string, ManualChatGroup[]>;
}

const WORKSPACE_UI_KEY = "workspace_ui";
export const WORKSPACE_UI_DEFAULTS: PersistedWorkspaceUiState = {
  archivedWorkspaceIds: [],
  hiddenRepoRootIds: [],
  collapsedRepoGroups: [],
  threadsCollapsed: false,
  sidebarOpen: false,
  sidebarWidth: WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
  workspaceTypes: DEFAULT_SIDEBAR_WORKSPACE_TYPES,
  lastViewedAt: {},
  lastViewedSessionByWorkspace: {},
  lastViewedSessionErrorAtBySession: {},
  workspaceLastInteracted: {},
  dismissedSetupFailures: {},
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
      threadsCollapsed: WORKSPACE_UI_DEFAULTS.threadsCollapsed,
      dismissedSetupFailures: WORKSPACE_UI_DEFAULTS.dismissedSetupFailures,
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
  const state = {
    ...WORKSPACE_UI_DEFAULTS,
    ...input,
  };
  let didMigrate = false;
  const previousMigrationVersion = state.migrationVersion ?? 0;
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

  if (typeof state.sidebarWidth !== "number" || Number.isNaN(state.sidebarWidth)) {
    state.sidebarWidth = WORKSPACE_UI_DEFAULTS.sidebarWidth;
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
    threadsCollapsed: state.threadsCollapsed,
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    workspaceTypes: state.workspaceTypes,
    lastViewedAt: state.lastViewedAt,
    lastViewedSessionByWorkspace: state.lastViewedSessionByWorkspace,
    lastViewedSessionErrorAtBySession: state.lastViewedSessionErrorAtBySession,
    workspaceLastInteracted: state.workspaceLastInteracted,
    dismissedSetupFailures: state.dismissedSetupFailures,
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

export const useWorkspaceUiStore = create<WorkspaceUiState>((set, get) => ({
  ...WORKSPACE_UI_DEFAULTS,
  _hydrated: false,

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

  setLastViewedSessionForWorkspace: (workspaceId, sessionId) => {
    set({
      lastViewedSessionByWorkspace: {
        ...get().lastViewedSessionByWorkspace,
        [workspaceId]: sessionId,
      },
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

  setVisibleChatSessionIdsForWorkspace: (workspaceId, sessionIds) => {
    set({
      visibleChatSessionIdsByWorkspace: {
        ...get().visibleChatSessionIdsByWorkspace,
        [workspaceId]: uniqueIds(sessionIds),
      },
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
