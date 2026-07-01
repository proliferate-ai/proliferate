export type CloudWorkspaceStatus =
  | "pending"
  | "materializing"
  | "needs_rematerialization"
  | "ready"
  | "archived"
  | "error";

export type CloudWorkspaceVisibility =
  | "private"
  | "shared_unclaimed"
  | "claimed"
  | "archived";

export type CloudWorkspaceExposureState =
  | "untracked"
  | "tracked"
  | "live"
  | "paused"
  | "stale"
  | "revoked";

export type CloudWorkspaceSandboxType =
  | "local"
  | "ssh"
  | "managed_personal"
  | "managed_shared"
  | "self_hosted";

export type CloudWorkspaceProductLifecycle = "active" | "archived" | "deleted";
export type CloudWorkspaceExecutionTargetKind =
  | "local_desktop"
  | "managed_cloud"
  | "ssh"
  | "self_hosted";
export type CloudWorkspaceMaterializationState =
  | "hydrated"
  | "dehydrated"
  | "hydrating"
  | "unknown"
  | "inconsistent";
export type CloudWorkspaceCleanupStatus =
  | "idle"
  | "pruning"
  | "blocked"
  | "failed"
  | "skipped"
  | "completed";
export type CloudWorkspaceCloudAccessState =
  | "disabled"
  | "enabled"
  | "enabling"
  | "error";

export type CloudRuntimeStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "paused"
  | "error"
  | "disabled";

export type CloudRuntimeAuthStatus =
  | "current"
  | "stale"
  | "restart_required"
  | "apply_failed"
  | "missing_credentials";

export interface CloudRuntimeAuthState {
  status: CloudRuntimeAuthStatus;
  configCurrent: boolean;
  targetCurrent: boolean;
  requiresRestart: boolean;
  desiredRevision?: number | null;
  appliedRevision?: number | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  lastAttemptedAt?: string | null;
  lastAppliedAt?: string | null;
}

export interface CloudWorkspaceRuntimeSummary {
  environmentId: string | null;
  status: CloudRuntimeStatus;
  generation: number;
  runtimeAuth?: CloudRuntimeAuthState | null;
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
}

export interface CloudWorkspaceRepoRef {
  provider: string;
  owner: string;
  name: string;
  branch: string;
  baseBranch: string;
}

export interface CloudWorkspaceOriginContext {
  kind: "human" | "cowork" | "api" | "system";
  entrypoint:
    | "desktop"
    | "cloud"
    | "local_runtime"
    | "cowork"
    | "api"
    | "web"
    | "mobile"
    | "slack";
}

export interface CloudWorkspaceCreatorContext {
  kind: "human" | "automation" | "agent";
  automationId?: string | null;
  automationRunId?: string | null;
  sourceSessionId?: string | null;
  sourceSessionWorkspaceId?: string | null;
  sessionLinkId?: string | null;
  sourceWorkspaceId?: string | null;
  label?: string | null;
}

export interface CloudWorkspaceDirectTargetContext {
  targetId: string;
  targetKind: string;
  anyharnessWorkspaceId: string;
}

export interface CloudWorkspaceExecutionTargetSummary {
  kind: CloudWorkspaceExecutionTargetKind;
  targetId?: string | null;
  label?: string | null;
  online?: boolean | null;
}

export interface CloudWorkspaceMaterializationSummary {
  id: string;
  targetId?: string | null;
  anyharnessWorkspaceId?: string | null;
  worktreePath?: string | null;
  state: CloudWorkspaceMaterializationState;
  desiredState: "hydrated" | "dehydrated";
  cleanupStatus: CloudWorkspaceCleanupStatus;
  cleanupLastError?: string | null;
  blockers?: string[];
  generation: number;
  storageBytes?: number | null;
}

export interface CloudWorkspaceCloudAccessSummary {
  state: CloudWorkspaceCloudAccessState;
  exposureId?: string | null;
  exposureRevision?: number | null;
  projectionState: CloudWorkspaceExposureState;
  commandable: boolean;
}

export interface CloudWorkspaceSummary {
  id: string;
  targetId?: string | null;
  displayName: string | null;
  repo: CloudWorkspaceRepoRef;
  status: CloudWorkspaceStatus;
  workspaceStatus: CloudWorkspaceStatus;
  productLifecycle?: CloudWorkspaceProductLifecycle;
  runtime?: CloudWorkspaceRuntimeSummary;
  executionTarget?: CloudWorkspaceExecutionTargetSummary;
  selectedMaterializationId?: string | null;
  primaryMaterialization?: CloudWorkspaceMaterializationSummary | null;
  cloudAccess?: CloudWorkspaceCloudAccessSummary;
  statusDetail: string | null;
  lastError: string | null;
  templateVersion: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  readyAt: string | null;
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
  postReadyPhase: string;
  postReadyFilesTotal: number;
  postReadyFilesApplied: number;
  postReadyStartedAt: string | null;
  postReadyCompletedAt: string | null;
  repoFilesLastFailedPath?: string | null;
  origin?: CloudWorkspaceOriginContext | null;
  creatorContext?: CloudWorkspaceCreatorContext | null;
  directTargetContext?: CloudWorkspaceDirectTargetContext | null;
  visibility: CloudWorkspaceVisibility;
  exposureState?: CloudWorkspaceExposureState;
  sandboxType?: CloudWorkspaceSandboxType;
  claimedByUserId?: string | null;
  claimId?: string | null;
  claimedAt?: string | null;
  claimSourceKind?: string | null;
}

export interface CreateCloudWorkspaceRequest {
  gitProvider: "github";
  gitOwner: string;
  gitRepoName: string;
  baseBranch?: string | null;
  branchName: string;
  displayName?: string | null;
  generatedName?: boolean | null;
  ownerScope: "personal" | "organization";
  organizationId?: string | null;
}

export interface CloudMobilityRepoRef {
  provider: string;
  owner: string;
  name: string;
  branch: string;
}

export interface CloudMobilityHandoffSummary {
  id: string;
  direction: string;
  sourceOwner: string;
  targetOwner: string;
  phase: string;
  requestedBranch: string;
  requestedBaseSha?: string | null;
  excludePaths: string[];
  failureCode?: string | null;
  failureDetail?: string | null;
  startedAt: string;
  heartbeatAt: string;
  finalizedAt?: string | null;
  cleanupCompletedAt?: string | null;
}

export interface CloudMobilityWorkspaceSummary {
  id: string;
  displayName?: string | null;
  repo: CloudMobilityRepoRef;
  owner: string;
  lifecycleState: string;
  statusDetail?: string | null;
  lastError?: string | null;
  cloudWorkspaceId?: string | null;
  cloudLostAt?: string | null;
  cloudLostReason?: string | null;
  activeHandoff?: CloudMobilityHandoffSummary | null;
  updatedAt: string | null;
  createdAt: string | null;
}
