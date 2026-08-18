import type { PersistedWorkspaceGitStatusSnapshot } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import type { RightPanelDurableState, RightPanelMaterializedState } from "#product/lib/domain/workspaces/shell/right-panel-model";
import {
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
} from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import type { SidebarWorkspaceVariant } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { ManualChatGroup } from "#product/lib/domain/workspaces/tabs/manual-groups";
import type { WorkspaceShellIntentKey, WorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { WORKSPACE_SIDEBAR_DEFAULT_WIDTH } from "#product/lib/domain/preferences/workspace-ui/sidebar";

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
 * v10: add session-scoped activity/read timestamps for chat tab unread dots.
 * v11: drop retired finish-suggestion sidebar dismissal state.
 * v12: add per-logical-workspace git/PR status snapshots.
 * v13: add a section-level Repositories collapse flag, distinct from the
 * per-repo-group collapse array — collapsing the section hides every repo
 * group's rows at once instead of each group owning its own toggle only.
 * v14: add pinned workspace ids for the sidebar Pinned section.
 * v15: drop the client-side archivedWorkspaceIds hide-set. The runtime's
 * lifecycle filter (`lifecycle=archived`) is now the single source of
 * truth for which workspaces are archived, so a stale persisted id can no
 * longer resurrect a hidden row.
 * v16: track a bounded set of the latest applied Workspace MCP pin receipts.
 * v17: add bounded renderer-local pin ordering barriers so history and delayed
 *      live observations cannot overwrite a later device-local choice.
 */
export const WORKSPACE_UI_MIGRATION_VERSION = 17;
export const WORKSPACE_PIN_INTENT_RECEIPT_LIMIT = 256;
export const WORKSPACE_PIN_LOCAL_BARRIER_LIMIT = 256;

export interface WorkspacePinIntentReceipt {
  requestId: string;
  seq: number;
}

export interface WorkspacePinLocalOrder {
  rendererEpoch: string;
  sequence: number;
}

export interface PersistedWorkspaceUiState {
  migrationVersion?: number;
  pinnedWorkspaceIds: string[];
  workspacePinIntentReceiptByTarget: Record<string, WorkspacePinIntentReceipt>;
  workspacePinLocalBarrierById: Record<string, WorkspacePinLocalOrder>;
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
  collapsedChatGroupsByWorkspace: Record<string, string[]>;
  manualChatGroupsByWorkspace: Record<string, ManualChatGroup[]>;
  gitStatusSnapshotByWorkspace: Record<string, PersistedWorkspaceGitStatusSnapshot>;
}

export interface WorkspaceUiChangeTrackedState extends PersistedWorkspaceUiState {
  archivingChatSessionIdsByWorkspace: Record<string, string[]>;
  shellActivationEpochByWorkspace: Record<string, number>;
  pendingChatActivationByWorkspace: Record<string, unknown>;
  urgentHighlightedChatSessionByWorkspace: Record<string, string | null>;
}

export const WORKSPACE_UI_DEFAULTS: PersistedWorkspaceUiState = {
  pinnedWorkspaceIds: [],
  workspacePinIntentReceiptByTarget: {},
  workspacePinLocalBarrierById: {},
  hiddenRepoRootIds: [],
  collapsedRepoGroups: [],
  showArchived: false,
  repositoriesCollapsed: false,
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
  sessionLastInteracted: {},
  sessionLastViewedAt: {},
  dismissedSetupFailures: {},
  visibleChatSessionIdsByWorkspace: {},
  recentlyHiddenChatSessionIdsByWorkspace: {},
  collapsedChatGroupsByWorkspace: {},
  manualChatGroupsByWorkspace: {},
  gitStatusSnapshotByWorkspace: {},
};
