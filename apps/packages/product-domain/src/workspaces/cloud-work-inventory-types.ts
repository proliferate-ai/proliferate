import type {
  CloudSessionProjection,
  CloudWorkspaceLastSessionSummary,
} from "@proliferate/cloud-sdk";

export type CloudWorkSource = "chats" | "slack" | "automation" | "api";

export type CloudWorkOwnerFilter = "all" | "private" | "shared" | "claimed" | "unclaimed";

export type CloudWorkStatusFilter = "active" | "running" | "blocked" | "ready" | "archived" | "error";

export type CloudWorkSort = "recent" | "created" | "name" | "repo" | "status";

export type CloudWorkOwnerKind = "private" | "claimed" | "unclaimed" | "archived";

export type RecentWorkStatusIndicatorKind =
  | "needs_input"
  | "running"
  | "review_ready"
  | "ready"
  | "error"
  | "idle";

export type RecentWorkStatusIndicatorTone =
  | "attention"
  | "progress"
  | "success"
  | "danger"
  | "muted";

export interface RecentWorkStatusIndicatorView {
  kind: RecentWorkStatusIndicatorKind;
  tone: RecentWorkStatusIndicatorTone;
  label: string;
  hollow: boolean;
  live: boolean;
}

export interface CloudWorkFilters {
  ownership?: CloudWorkOwnerFilter;
  sources?: ReadonlySet<CloudWorkSource>;
  semanticSources?: ReadonlySet<RecentWorkSourceKind>;
  runtimeLocations?: ReadonlySet<RecentWorkRuntimeLocation>;
  statuses?: ReadonlySet<CloudWorkStatusFilter>;
  repoLabels?: ReadonlySet<string>;
  sort?: CloudWorkSort;
  needsAttention?: boolean;
  search?: string | null;
}

export interface CloudWorkOpenTarget {
  workspaceId: string;
  sessionId: string | null;
}

export interface CloudWorkItemView {
  id: string;
  title: string;
  subtitle: string;
  sourceAgentKind: string | null;
  source: CloudWorkSource;
  sourceLabel: string;
  sourceKind: RecentWorkSourceKind;
  semanticSourceLabel: string;
  runtimeLocation: RecentWorkRuntimeLocation;
  runtimeLocationLabel: string;
  cloudAccessState: RecentWorkCloudAccessState;
  cloudAccessLabel: string;
  commandability: RecentWorkCommandability;
  commandabilityLabel: string;
  ownerKind: CloudWorkOwnerKind;
  ownerLabel: string;
  status: CloudWorkStatusFilter;
  statusLabel: string;
  statusIndicator: RecentWorkStatusIndicatorView;
  activityPreview: string | null;
  branchLabel: string;
  repoLabel: string;
  runtimeLabel: string;
  lastActivityLabel: string;
  lastActivityMs: number;
  createdAtMs: number;
  unclaimed: boolean;
  defaultSessionId: string | null;
  sessionCount: number;
  currentSessionLabel: string;
  searchText: string;
  openTarget: CloudWorkOpenTarget;
}

export interface CloudWorkGroupView {
  id: CloudWorkSource;
  label: string;
  items: CloudWorkItemView[];
}

export type CloudWorkRecencyGroupId = "today" | "this_week" | "last_week" | "earlier";

export interface CloudWorkRecencyGroupView {
  id: CloudWorkRecencyGroupId;
  label: string;
  items: CloudWorkItemView[];
}

export type RecentWorkRowKind = "workspace" | "session" | "pending-session";

export type RecentWorkSourceKind =
  | "desktop_exposed"
  | "cloud_sandbox"
  | "web"
  | "mobile"
  | "personal_automation"
  | "team_automation"
  | "slack"
  | "api"
  | "unknown";

export type RecentWorkRuntimeLocation =
  | "local_desktop"
  | "cloud_sandbox"
  | "ssh_remote"
  | "offline"
  | "unknown";

export type RecentWorkCloudAccessState = "enabled" | "not_enabled" | "unknown";

export type RecentWorkCommandability =
  | "commandable"
  | "not_commandable"
  | "stale"
  | "unknown";

export type RecentWorkOwnership = "mine" | "team" | "unclaimed" | "unknown";

export type RecentWorkState =
  | "idle"
  | "running"
  | "review"
  | "blocked"
  | "done"
  | "pending"
  | "unknown";

export type RecentWorkOpenTarget =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "session"; workspaceId: string; sessionId: string }
  | { kind: "pending-session"; workspaceId: string; pendingSessionKey: string };

export interface RecentWorkItemView {
  id: string;
  rowKind: RecentWorkRowKind;
  workspaceId: string;
  sessionId: string | null;
  pendingSessionKey?: string;
  openTarget: RecentWorkOpenTarget;
  title: string;
  subtitle?: string;
  repoLabel?: string;
  branchLabel?: string;
  sourceKind: RecentWorkSourceKind;
  sourceLabel: string;
  runtimeLocation: RecentWorkRuntimeLocation;
  runtimeLabel: string;
  cloudAccessState: RecentWorkCloudAccessState;
  cloudAccessLabel: string;
  commandability: RecentWorkCommandability;
  commandabilityLabel: string;
  ownership: RecentWorkOwnership;
  ownershipLabel: string;
  lastActivityAt: string | null;
  lastActivityMs: number;
  lastActivityLabel: string;
  state: RecentWorkState;
  stateLabel: string;
  statusIndicator: RecentWorkStatusIndicatorView;
  activityPreview: string | null;
  searchText: string;
}

export type CloudCommandReadinessState =
  | "ready"
  | "claim_required"
  | "workspace_not_ready"
  | "runtime_offline"
  | "runtime_unavailable"
  | "commandability_unknown";

export interface CloudCommandReadinessView {
  state: CloudCommandReadinessState;
  commandable: boolean;
  message: string | null;
}

export interface BuildCloudWorkInventoryOptions {
  nowMs?: number;
  filters?: CloudWorkFilters;
}

export interface BuildRecentWorkItemsOptions {
  activeWorkspaceId?: string | null;
  activeWorkspaceSessions?: readonly CloudSessionProjection[];
  nowMs?: number;
  limit?: number;
}

export const CLOUD_WORK_SOURCE_ORDER: readonly CloudWorkSource[] = [
  "chats",
  "slack",
  "automation",
  "api",
];

export const SOURCE_LABELS: Record<CloudWorkSource, string> = {
  chats: "Chats",
  slack: "Slack",
  automation: "Workflows",
  api: "API",
};

export const STATUS_LABELS: Record<CloudWorkStatusFilter, string> = {
  active: "Active",
  running: "Running",
  blocked: "Blocked",
  ready: "Ready",
  archived: "Archived",
  error: "Error",
};

export type { CloudSessionProjection, CloudWorkspaceLastSessionSummary };
