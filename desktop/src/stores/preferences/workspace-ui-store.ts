import type { SetStateAction } from "react";
import { create } from "zustand";
import { readPersistedValue, persistValue } from "@/lib/infra/preferences-persistence";

export interface WorkspaceUiState {
  _hydrated: boolean;
  archivedWorkspaceIds: string[];
  collapsedRepoGroups: string[];
  sidebarOpen: boolean;
  sidebarWidth: number;
  lastViewedAt: Record<string, string>;
  lastViewedSessionByWorkspace: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  dismissedSetupFailures: Record<string, boolean>;
  archiveWorkspace: (id: string) => void;
  archiveWorkspaces: (ids: string[]) => void;
  unarchiveWorkspace: (id: string) => void;
  toggleRepoGroupCollapsed: (repoKey: string) => void;
  ensureRepoGroupExpanded: (repoKey: string) => void;
  setSidebarOpen: (value: SetStateAction<boolean>) => void;
  setSidebarWidth: (value: SetStateAction<number>) => void;
  markWorkspaceViewed: (workspaceId: string) => void;
  setLastViewedSessionForWorkspace: (workspaceId: string, sessionId: string) => void;
  clearLastViewedSessionForWorkspace: (workspaceId: string, sessionId?: string) => void;
  updateWorkspaceLastInteracted: (workspaceId: string, timestamp: string) => void;
  dismissSetupFailure: (workspaceId: string) => void;
  clearSetupFailureDismissal: (workspaceId: string) => void;
}

/**
 * We have not launched yet, so persisted workspace UI state is allowed to
 * reset across identity-model changes.
 * v1: reset false-unread state caused by wall-clock interaction timestamps.
 * v2: reset user-facing workspace-keyed state for logical-workspace cutover.
 */
const WORKSPACE_UI_MIGRATION_VERSION = 2;
export const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 280;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 220;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 420;

interface PersistedWorkspaceUiState {
  migrationVersion?: number;
  archivedWorkspaceIds: string[];
  collapsedRepoGroups: string[];
  sidebarOpen: boolean;
  sidebarWidth: number;
  lastViewedAt: Record<string, string>;
  lastViewedSessionByWorkspace: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  dismissedSetupFailures: Record<string, boolean>;
}

const WORKSPACE_UI_KEY = "workspace_ui";
const WORKSPACE_UI_DEFAULTS: PersistedWorkspaceUiState = {
  archivedWorkspaceIds: [],
  collapsedRepoGroups: [],
  sidebarOpen: false,
  sidebarWidth: WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
  lastViewedAt: {},
  lastViewedSessionByWorkspace: {},
  workspaceLastInteracted: {},
  dismissedSetupFailures: {},
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
      sidebarOpen: WORKSPACE_UI_DEFAULTS.sidebarOpen,
      sidebarWidth: WORKSPACE_UI_DEFAULTS.sidebarWidth,
      lastViewedAt:
        (await readPersistedValue<Record<string, string>>("lastViewedAt"))
        ?? WORKSPACE_UI_DEFAULTS.lastViewedAt,
      lastViewedSessionByWorkspace:
        (await readPersistedValue<Record<string, string>>("lastViewedSessionByWorkspace"))
        ?? WORKSPACE_UI_DEFAULTS.lastViewedSessionByWorkspace,
      workspaceLastInteracted:
        (await readPersistedValue<Record<string, string>>("workspaceLastInteracted"))
        ?? WORKSPACE_UI_DEFAULTS.workspaceLastInteracted,
      collapsedRepoGroups: WORKSPACE_UI_DEFAULTS.collapsedRepoGroups,
      dismissedSetupFailures: WORKSPACE_UI_DEFAULTS.dismissedSetupFailures,
    };
  }

  let didMigrate = false;
  if ((state.migrationVersion ?? 0) < WORKSPACE_UI_MIGRATION_VERSION) {
    state.archivedWorkspaceIds = [];
    state.lastViewedAt = {};
    state.lastViewedSessionByWorkspace = {};
    state.workspaceLastInteracted = {};
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

  const clampedSidebarWidth = clampSidebarWidth(state.sidebarWidth);
  if (clampedSidebarWidth !== state.sidebarWidth) {
    state.sidebarWidth = clampedSidebarWidth;
    didMigrate = true;
  }

  return { state, didMigrate };
}

function selectPersistedSlice(state: WorkspaceUiState): PersistedWorkspaceUiState {
  return {
    migrationVersion: WORKSPACE_UI_MIGRATION_VERSION,
    archivedWorkspaceIds: state.archivedWorkspaceIds,
    collapsedRepoGroups: state.collapsedRepoGroups,
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    lastViewedAt: state.lastViewedAt,
    lastViewedSessionByWorkspace: state.lastViewedSessionByWorkspace,
    workspaceLastInteracted: state.workspaceLastInteracted,
    dismissedSetupFailures: state.dismissedSetupFailures,
  };
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

  unarchiveWorkspace: (id) => {
    const current = get().archivedWorkspaceIds;
    const next = current.filter((workspaceId) => workspaceId !== id);
    if (next.length === current.length) {
      return;
    }
    set({ archivedWorkspaceIds: next });
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

export function ensureRepoGroupExpanded(repoKey: string) {
  useWorkspaceUiStore.getState().ensureRepoGroupExpanded(repoKey);
}
