import type {
  CloudWorkStatusFilter,
  RecentWorkCloudAccessState,
  RecentWorkCommandability,
  RecentWorkRuntimeLocation,
  RecentWorkSourceKind,
} from "./cloud-work-inventory";

export type WorkspaceInventorySourceKind = RecentWorkSourceKind;

export type WorkspaceInventoryLocationKind =
  | "worktree"
  | "local"
  | "managed_personal"
  | "managed_shared"
  | "ssh"
  | "self_hosted"
  | "cloud"
  | "session"
  | "other";

export type WorkspaceInventoryStatusKind =
  | "waiting"
  | "working"
  | "review"
  | "blocked"
  | "done";

export type WorkspaceInventoryStatusFilterKind = CloudWorkStatusFilter;

export type WorkspaceInventoryOwnershipKind =
  | "mine"
  | "unclaimed"
  | "claimed"
  | "team"
  | "archived";

export type WorkspaceInventoryFilterId =
  | "all"
  | `status:${WorkspaceInventoryStatusFilterKind}`;

export type WorkspaceInventoryGroupBy =
  | "ownership"
  | "source"
  | "status"
  | "runtime";

export interface WorkspaceInventoryItemView {
  id: string;
  title: string;
  description?: string | null;
  repoLabel?: string | null;
  branchLabel?: string | null;
  sourceKind: WorkspaceInventorySourceKind;
  sourceLabel: string;
  locationKind: WorkspaceInventoryLocationKind;
  locationLabel: string;
  runtimeLocation: RecentWorkRuntimeLocation;
  runtimeLocationLabel: string;
  cloudAccessState: RecentWorkCloudAccessState;
  cloudAccessLabel: string;
  commandability: RecentWorkCommandability;
  commandabilityLabel: string;
  scopeLabel?: string | null;
  statusKind: WorkspaceInventoryStatusKind;
  statusLabel: string;
  statusFilterKind?: WorkspaceInventoryStatusFilterKind;
  ownershipKind?: WorkspaceInventoryOwnershipKind;
  ownerLabel?: string | null;
  exposureLabel?: string | null;
  sessionLabel?: string | null;
  updatedLabel?: string | null;
  active?: boolean;
}

export interface WorkspaceInventoryGroupView {
  id: string;
  label: string;
  count: number;
  statusKind?: WorkspaceInventoryStatusKind;
  suppressOwnerLabel?: boolean;
  collapsed?: boolean;
  attention?: boolean;
  items: WorkspaceInventoryItemView[];
}

export interface WorkspaceInventoryFilterOption {
  id: WorkspaceInventoryFilterId;
  label: string;
  count: number;
}

export interface WorkspaceInventoryGroupOption {
  id: WorkspaceInventoryGroupBy;
  label: string;
}

export interface BuildCloudWorkspaceInventoryOptions {
  now?: number;
}
