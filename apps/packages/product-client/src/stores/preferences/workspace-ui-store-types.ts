import type { SetStateAction } from "react";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import type { PersistedWorkspaceUiState } from "#product/lib/domain/preferences/workspace-ui/model";
import type { PersistedWorkspaceGitStatusSnapshot } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import type { RightPanelDurableState, RightPanelMaterializedState, RightPanelWorkspaceState } from "#product/lib/domain/workspaces/shell/right-panel-model";
import type { SidebarWorkspaceVariant } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { ManualChatGroup } from "#product/lib/domain/workspaces/tabs/manual-groups";
import type { PendingChatActivation } from "#product/lib/domain/workspaces/tabs/shell-activation";
import type { WorkspaceShellIntentKey, WorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import type {
  ChatSessionArchiveReservation,
  ChatVisibilityCandidate,
} from "#product/lib/domain/workspaces/tabs/visibility";

/**
 * See `pendingBackgroundSubagentSelectionByWorkspace` — `sessionId` is the
 * session active at write time, checked against the consuming pane's own
 * `sessionId` so a cross-session entry is discarded rather than applied.
 */
export interface PendingBackgroundSubagentSelection {
  subagentId: string;
  sessionId: string;
}

export interface WorkspaceUiState {
  _hydrated: boolean;
  pinnedWorkspaceIds: string[];
  hiddenRepoRootIds: string[];
  collapsedRepoGroups: string[];
  showArchived: boolean;
  repositoriesCollapsed: boolean;
  threadsCollapsed: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightPanelDurableByWorkspace: Record<string, RightPanelDurableState>;
  rightPanelMaterializedByWorkspace: Record<string, RightPanelMaterializedState>;
  activeShellTabKeyByWorkspace: Record<string, WorkspaceShellIntentKey | null>;
  shellTabOrderByWorkspace: Record<string, WorkspaceShellTabKey[]>;
  shellActivationEpochByWorkspace: Record<string, number>;
  pendingChatActivationByWorkspace: Record<string, PendingChatActivation | null>;
  /**
   * One-shot deep-link target: a native subagent id to select the instant
   * `BackgroundWorkPane` next renders for this workspace (transcript click →
   * `useOpenBackgroundWorkPane`'s extended return; Delivery Spec — Background
   * Work Slice 1, rung R4 fix-forward). Session-only, never persisted —
   * mirrors `pendingChatActivationByWorkspace`'s ephemeral-field placement,
   * but without its epoch/nonce/guard-token machinery. Keyed by workspace
   * only (one right-panel model per workspace), but carries the `sessionId`
   * active at write time (review round 2) — the pane checks it against its
   * own `sessionId` on consume and discards a mismatch rather than applying
   * it, so a stale selection from an abandoned or different session in the
   * same workspace never leaks into the wrong session's roster lookup.
   * Cleared by the pane the instant it is read, matched or not.
   */
  pendingBackgroundSubagentSelectionByWorkspace: Record<
    string,
    PendingBackgroundSubagentSelection | null
  >;
  /**
   * Finish-signal ladder rung 1 (`PanelHeaderEntry` dirty dot) — the epoch-ms
   * timestamp the Background work pane was last actually open for this
   * session. Session-scoped, never persisted (D6 rules out workspace-level
   * persistence for this slice): a reload starts every session back at
   * "never viewed", which only matters for work that already finished
   * before the reload — live roster state itself survives via the session
   * GET seed + SSE fold, unaffected by this being ephemeral.
   */
  backgroundWorkLastViewedAtBySession: Record<string, number>;
  /**
   * Finish-signal ladder rungs 1-2 — the only record of a native subagent's
   * finish that will ever exist. Subagents leave the roster the instant
   * they finish, so `useBackgroundWorkFinishSignalTracking` caches the last
   * snapshot it observed (running, or already flipped if the wire ever
   * shows that before removal) plus `detectedAtMs`: the epoch-ms moment it
   * noticed the disappearance, deliberately NOT the subagent's real finish
   * time (which is unknowable client-side — R5 review round 2). Session-
   * scoped, never persisted — same ephemeral placement as
   * `pendingBackgroundSubagentSelectionByWorkspace` above.
   */
  backgroundWorkLastFinishedSubagentBySession: Record<
    string,
    { subagent: ActivitySubagentWire; detectedAtMs: number } | null
  >;
  urgentHighlightedChatSessionByWorkspace: Record<string, string | null>;
  workspaceTypes: SidebarWorkspaceVariant[];
  lastViewedAt: Record<string, string>;
  lastViewedSessionByWorkspace: Record<string, string>;
  lastViewedSessionErrorAtBySession: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  sessionLastInteracted: Record<string, string>;
  sessionLastViewedAt: Record<string, string>;
  dismissedSetupFailures: Record<string, boolean>;
  visibleChatSessionIdsByWorkspace: Record<string, string[]>;
  recentlyHiddenChatSessionIdsByWorkspace: Record<string, string[]>;
  archivingChatSessionIdsByWorkspace: Record<string, string[]>;
  collapsedChatGroupsByWorkspace: Record<string, string[]>;
  manualChatGroupsByWorkspace: Record<string, ManualChatGroup[]>;
  gitStatusSnapshotByWorkspace: Record<string, PersistedWorkspaceGitStatusSnapshot>;
  hydrate: (state: PersistedWorkspaceUiState) => void;
  pinWorkspace: (id: string) => void;
  unpinWorkspace: (ids: string[]) => void;
  hideRepoRoot: (repoRootId: string) => void;
  unhideRepoRoot: (repoRootId: string) => void;
  toggleRepoGroupCollapsed: (repoKey: string) => void;
  ensureRepoGroupExpanded: (repoKey: string) => void;
  setCollapsedRepoGroups: (keys: string[]) => void;
  setShowArchived: (value: boolean) => void;
  setRepositoriesCollapsed: (value: boolean) => void;
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
  setPendingBackgroundSubagentSelectionForWorkspace: (
    workspaceId: string,
    selection: PendingBackgroundSubagentSelection,
  ) => void;
  clearPendingBackgroundSubagentSelectionForWorkspace: (
    workspaceId: string,
  ) => void;
  markBackgroundWorkViewedForSession: (sessionId: string, atMs?: number) => void;
  recordBackgroundWorkFinishedSubagentForSession: (
    sessionId: string,
    subagent: ActivitySubagentWire,
    detectedAtMs: number,
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
  setVisibleChatSessionIdsForWorkspace: (workspaceId: string, sessionIds: string[]) => void;
  rememberHiddenChatSessionForWorkspace: (workspaceId: string, sessionId: string) => void;
  clearHiddenChatSessionsForWorkspace: (workspaceId: string, sessionIds: string[]) => void;
  reserveChatSessionArchiveForWorkspace: (input: {
    activeSessionId: string | null;
    liveSessions: ChatVisibilityCandidate[];
    sessionId: string;
    workspaceId: string;
  }) => ChatSessionArchiveReservation;
  completeChatSessionArchiveForWorkspace: (
    workspaceId: string,
    sessionIds: string[],
  ) => void;
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
  recordWorkspaceGitStatusSnapshot: (
    logicalWorkspaceId: string,
    snapshot: PersistedWorkspaceGitStatusSnapshot,
  ) => void;
  stampWorkspaceGitPrompt: (logicalWorkspaceId: string, at: string) => void;
  pruneWorkspaceGitStatusSnapshots: (liveLogicalWorkspaceIds: string[]) => void;
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
