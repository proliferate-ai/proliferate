export type CloudTargetKind =
  | "managed_cloud"
  | "ssh"
  | "desktop_dispatch"
  | "local_direct"
  | "self_hosted_cloud";

export type CloudTargetStatus = "online" | "offline" | "degraded" | "enrolling";

export interface CloudTargetCapability {
  key: string;
  available: boolean;
  detail?: string | null;
}

export interface CloudTargetInventory {
  os?: string | null;
  arch?: string | null;
  distro?: string | null;
  shell?: string | null;
  git?: CloudTargetCapability | null;
  node?: CloudTargetCapability | null;
  python?: CloudTargetCapability | null;
  browser?: CloudTargetCapability | null;
  capabilities?: CloudTargetCapability[];
}

export interface CloudTargetSummary {
  id: string;
  displayName: string;
  kind: CloudTargetKind;
  status: CloudTargetStatus;
  ownerScope: "personal" | "organization";
  organizationId?: string | null;
  lastSeenAt?: string | null;
  anyharnessVersion?: string | null;
  workerVersion?: string | null;
  inventory?: CloudTargetInventory | null;
}

export interface CloudTargetDetail extends CloudTargetSummary {
  createdAt?: string | null;
  updatedAt?: string | null;
  access?: {
    canUse: boolean;
    canOpenDirectly: boolean;
    reason?: string | null;
  } | null;
}

export interface CloudTargetEnrollmentRequest {
  displayName: string;
  kind: Exclude<CloudTargetKind, "local_direct">;
  ownerScope?: "personal" | "organization";
  organizationId?: string | null;
  expiresInSeconds?: number | null;
}

export interface CloudTargetEnrollmentResponse {
  enrollmentId: string;
  targetId: string;
  token: string;
  installCommand?: string | null;
  expiresAt: string;
}

