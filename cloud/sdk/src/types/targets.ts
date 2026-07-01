import type { Schema } from "./schema.js";

export type CloudTargetKind =
  | "managed_cloud"
  | "ssh"
  | "desktop_dispatch"
  | "local_direct"
  | "self_hosted_cloud";

export type CloudTargetStatus = "online" | "offline" | "degraded" | "enrolling" | "archived";
export type CloudTargetUpdateChannel = "stable" | "beta" | "pinned";

export type CloudTargetInventory = Schema<"CloudTargetInventoryModel">;

export interface CloudTargetStatusDetail {
  status: CloudTargetStatus;
  statusDetail?: string | null;
  lastSeenAt?: string | null;
  lastHeartbeatAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface CloudTargetSummary {
  id: string;
  displayName: string;
  kind: CloudTargetKind;
  status: CloudTargetStatus;
  ownerScope: "personal" | "organization";
  sandboxProfileId?: string | null;
  profileTargetRole?: "primary" | "none" | string;
  organizationId?: string | null;
  defaultWorkspaceRoot?: string | null;
  inventory?: CloudTargetInventory | null;
  statusDetail?: CloudTargetStatusDetail | null;
  update?: {
    generation?: number | null;
    channel?: string | null;
    status?: string | null;
    desiredVersions?: Record<string, unknown> | null;
    reportedAt?: string | null;
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

export interface CloudTargetDetail extends CloudTargetSummary {
  ownerUserId?: string | null;
  createdByUserId: string;
}

export type CloudTargetEnrollmentRequest = Omit<
  Schema<"CloudTargetEnrollmentRequest">,
  "kind"
> & {
  kind: Exclude<CloudTargetKind, "local_direct" | "managed_cloud">;
};

export type CloudTargetEnrollmentResponse =
  Schema<"CloudTargetEnrollmentResponse">;

export type CloudTargetExistingEnrollmentRequest =
  Schema<"CloudTargetExistingEnrollmentRequest">;

export type ArchiveCloudTargetResponse =
  Schema<"ArchiveCloudTargetResponse">;

export type SetDesiredVersionsRequest = Omit<
  Schema<"SetDesiredVersionsRequest">,
  "updateChannel"
> & {
  updateChannel?: CloudTargetUpdateChannel | null;
};

export type SetDesiredVersionsResponse =
  Schema<"SetDesiredVersionsResponse">;

export type SafeStopCheckResponse =
  Schema<"SafeStopCheckResponse">;

export type RevokeWorkersResponse =
  Schema<"RevokeWorkersResponse">;
