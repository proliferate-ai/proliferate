import type { SetStateAction } from "react";
import { create } from "zustand";
import type { ManualChatGroup } from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  toggleSidebarWorkspaceTypeSelection,
  type SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar/sidebar";
import {
  clampRightPanelWidth,
  DEFAULT_RIGHT_PANEL_DURABLE_STATE,
  DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE,
  normalizeRightPanelDurableState,
  reconcileRightPanelWorkspaceState,
  type RightPanelDurableState,
  type RightPanelMaterializedState,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel";
import type { PendingChatActivation } from "@/lib/domain/workspaces/tabs/shell-activation";
import {
  type WorkspaceShellIntentKey,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  clampWorkspaceSidebarWidth,
  WORKSPACE_UI_DEFAULTS,
  type PersistedWorkspaceUiState,
} from "@/lib/domain/preferences/workspace-ui-state";
import { createWorkspaceUiChatTabActions } from "@/stores/preferences/workspace-ui-chat-tab-actions";
import { createWorkspaceUiShellActions } from "@/stores/preferences/workspace-ui-shell-actions";

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
  urgentHighlightedChatSessionByWorkspace: Record<string, string | null>;
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
  hydrate: (state: PersistedWorkspaceUiState) => void;
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
  setUrgentHighlightedChatSessionForWorkspace: (
    workspaceId: string,
    sessionId: string,
  ) => void;
  clearUrgentHighlightedChatSessionForWorkspace: (
    workspaceId: string,
    sessionId?: string,
  ) => void;
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

export interface ShellIntentResult {
  changed: boolean;
  previousIntent: WorkspaceShellIntentKey | null;
  currentIntent: WorkspaceShellIntentKey | null;
  epoch: number;
}

function resolveStateValue<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === "function"
    ? (value as (previousValue: T) => T)(current)
    : value;
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
  urgentHighlightedChatSessionByWorkspace: {},

  hydrate: (state) => {
    set({
      ...state,
      _hydrated: true,
    });
  },

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
      sidebarWidth: clampWorkspaceSidebarWidth(resolveStateValue(value, state.sidebarWidth)),
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

  ...createWorkspaceUiShellActions(set, get),

  setUrgentHighlightedChatSessionForWorkspace: (workspaceId, sessionId) => {
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

  ...createWorkspaceUiChatTabActions(set, get),
}));

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
