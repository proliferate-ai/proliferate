export type ComputeTargetKind =
  | "managed_cloud"
  | "ssh"
  | "desktop_dispatch"
  | "local_direct"
  | "self_hosted_cloud";

export type ComputeTargetStatus = "online" | "offline" | "degraded" | "enrolling" | "archived";

export interface ComputeTargetInventory {
  os?: string | null;
  arch?: string | null;
  distro?: string | null;
  shell?: string | null;
  git?: Record<string, unknown> | null;
  node?: Record<string, unknown> | null;
  python?: Record<string, unknown> | null;
  browser?: Record<string, unknown> | null;
  capabilities?: Record<string, unknown> | null;
  providers?: Record<string, unknown> | null;
  mcp?: Record<string, unknown> | null;
  updatedAt: string;
}

export interface ComputeTargetStatusDetail {
  status: ComputeTargetStatus;
  statusDetail?: string | null;
  lastSeenAt?: string | null;
  lastHeartbeatAt?: string | null;
  updatedAt?: string | null;
}

export interface ComputeTargetSummary {
  id: string;
  displayName: string;
  kind: ComputeTargetKind;
  status: ComputeTargetStatus;
  ownerScope: "personal" | "organization";
  sandboxProfileId?: string | null;
  profileTargetRole?: "primary" | "none" | string;
  organizationId?: string | null;
  defaultWorkspaceRoot?: string | null;
  inventory?: ComputeTargetInventory | null;
  statusDetail?: ComputeTargetStatusDetail | null;
  update?: {
    channel?: string | null;
    status?: string | null;
    currentVersions?: {
      workerId?: string | null;
      anyharnessVersion?: string | null;
      workerVersion?: string | null;
      supervisorVersion?: string | null;
      reportedAt?: string | null;
    } | null;
  } | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComputeTargetDetail extends ComputeTargetSummary {
  ownerUserId?: string | null;
  createdByUserId: string;
}

export interface ComputeRuntimeConfigStatus {
  currentRevision?: {
    revisionId: string;
    sequence: number;
    contentHash: string;
    createdAt: string;
  } | null;
}
