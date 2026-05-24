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

export interface CloudWorkspaceSummary {
  id: string;
  targetId?: string | null;
  displayName: string | null;
  repo: CloudWorkspaceRepoRef;
  status: CloudWorkspaceStatus;
  workspaceStatus: CloudWorkspaceStatus;
  runtime?: CloudWorkspaceRuntimeSummary;
  statusDetail: string | null;
  lastError: string | null;
  templateVersion: string | null;
  updatedAt: string | null;
  createdAt: string | null;
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

export interface CloudRepoConfigSummary {
  gitOwner: string;
  gitRepoName: string;
  configured: boolean;
  configuredAt: string | null;
  filesVersion: number;
}

export interface CreateCloudWorkspaceRequest {
  gitProvider: "github";
  gitOwner: string;
  gitRepoName: string;
  baseBranch?: string | null;
  branchName: string;
  displayName?: string | null;
  ownerScope: "personal" | "organization";
  organizationId?: string | null;
  requiredAgentKind?: string | null;
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
