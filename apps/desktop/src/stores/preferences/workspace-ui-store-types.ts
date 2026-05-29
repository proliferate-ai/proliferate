import type { SetStateAction } from "react";
import type { PersistedWorkspaceUiState } from "@/lib/domain/preferences/workspace-ui/model";
import type { RightPanelDurableState, RightPanelMaterializedState, RightPanelWorkspaceState } from "@/lib/domain/workspaces/shell/right-panel-model";
import type { SidebarWorkspaceVariant } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { ManualChatGroup } from "@/lib/domain/workspaces/tabs/manual-groups";
import type { PendingChatActivation } from "@/lib/domain/workspaces/tabs/shell-activation";
import type { WorkspaceShellIntentKey, WorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";

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
  sessionLastInteracted: Record<string, string>;
  sessionLastViewedAt: Record<string, string>;
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
  }) => { set: boolean };
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
  updateSessionLastInteracted: (sessionId: string, timestamp: string) => void;
  markSessionViewedAt: (sessionId: string, timestamp: string) => void;
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

export type WorkspaceUiSet = (
  partial:
    | Partial<WorkspaceUiState>
    | WorkspaceUiState
    | ((state: WorkspaceUiState) => Partial<WorkspaceUiState> | WorkspaceUiState),
) => void;

export type WorkspaceUiGet = () => WorkspaceUiState;
