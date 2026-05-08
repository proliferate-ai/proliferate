export type CloudWorkspaceStatus =
  | "pending"
  | "materializing"
  | "ready"
  | "archived"
  | "error";

export type CloudRuntimeStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "paused"
  | "error"
  | "disabled";

export type CloudCredentialFreshnessStatus =
  | "current"
  | "stale"
  | "restart_required"
  | "apply_failed"
  | "missing_credentials";

export interface CloudCredentialFreshness {
  status: CloudCredentialFreshnessStatus;
  filesCurrent: boolean;
  processCurrent: boolean;
  requiresRestart: boolean;
  lastError?: string | null;
  lastErrorAt?: string | null;
  filesAppliedAt?: string | null;
  processAppliedAt?: string | null;
}

export interface CloudWorkspaceRuntimeSummary {
  environmentId: string | null;
  status: CloudRuntimeStatus;
  generation: number;
  credentialFreshness?: CloudCredentialFreshness | null;
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
  entrypoint: "desktop" | "cloud" | "local_runtime" | "cowork";
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

export interface CloudWorkspaceSummary {
  id: string;
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
