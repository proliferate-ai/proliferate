import type { components } from "../generated/openapi.js";

// Narrow string unions — kept hand-written because the server declares these as `str`
// and the generated types would be too loose (`string`) for UI switch/display logic.
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

export interface CloudWorkspaceExposureSummary {
  id: string;
  visibility: CloudWorkspaceVisibility;
  claimedByUserId?: string | null;
  defaultProjectionLevel: string;
  commandable: boolean;
  status: "active" | "paused" | "stale" | "revoked";
}

export interface CloudWorkspaceLastSessionSummary {
  targetId: string;
  workspaceId?: string | null;
  sessionId: string;
  sourceAgentKind?: string | null;
  title?: string | null;
  status: string;
  phase?: string | null;
  pendingInteractionCount?: number;
  lastEventAt?: string | null;
  preview?: string | null;
}

export type CloudRuntimeStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "paused"
  | "error"
  | "disabled";

export type CloudRuntimeAuthState =
  components["schemas"]["WorkspaceRuntimeAuthState"];
export type CloudRuntimeAuthStatus = CloudRuntimeAuthState["status"];

export interface CloudWorkspaceRuntimeSummary {
  environmentId: string | null;
  status: CloudRuntimeStatus;
  generation: number;
  runtimeAuth?: CloudRuntimeAuthState | null;
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
}

export type CloudAgentKind = "claude" | "codex" | "opencode" | "gemini" | "grok";

export function isCloudAgentKind(value: string): value is CloudAgentKind {
  return value === "claude" || value === "codex" || value === "opencode" || value === "gemini" || value === "grok";
}

// Generated type aliases — names preserved so all existing import sites are unchanged.
export type RepoRef                   = components["schemas"]["RepoRef"];
export type ManagedSandboxResponse    = components["schemas"]["ManagedSandboxResponse"];
export type BillingPlanInfo           = components["schemas"]["CloudPlanInfo"];
export type BillingUrlResponse        = components["schemas"]["BillingUrlResponse"];
export type OverageSettingsResponse   = components["schemas"]["OverageSettingsResponse"];
export type BillingOwnerSelection     = components["schemas"]["BillingOwnerSelection"];
export type OrganizationUpdateRequest = components["schemas"]["OrganizationUpdateRequest"];
export type OrganizationInviteRequest = components["schemas"]["OrganizationInviteRequest"];
export type OrganizationMembershipUpdateRequest =
  components["schemas"]["OrganizationMembershipUpdateRequest"];
export type OrganizationInvitationAcceptRequest =
  components["schemas"]["OrganizationInvitationAcceptRequest"];
export type OrganizationStatus = "pending_checkout" | "active" | "suspended" | "archived";
export type OrganizationResponse = components["schemas"]["OrganizationResponse"] & {
  status: OrganizationStatus;
};
export type OrganizationListResponse = Omit<
  components["schemas"]["OrganizationListResponse"],
  "organizations"
> & {
  organizations: OrganizationResponse[];
};
export type OrganizationMemberResponse =
  components["schemas"]["OrganizationMemberResponse"];
export type OrganizationMembersResponse =
  components["schemas"]["OrganizationMembersResponse"];
export type OrganizationMembershipResponse =
  components["schemas"]["OrganizationMembershipResponse"];
export type OrganizationInvitationResponse =
  components["schemas"]["OrganizationInvitationResponse"];
export type OrganizationInvitationsResponse =
  components["schemas"]["OrganizationInvitationsResponse"];
export type OrganizationJoinLinkResponse =
  components["schemas"]["OrganizationJoinLinkResponse"];
export type OrganizationInvitationAcceptResponse =
  components["schemas"]["OrganizationInvitationAcceptResponse"];
export interface TeamCheckoutRequest {
  teamName: string;
  inviteEmails?: string[];
  returnSurface?: "desktop" | "web";
}
export interface TeamCheckoutResponse {
  url: string;
  intentId: string;
}
export interface TeamCheckoutIntentResponse {
  id: string;
  organizationId: string;
  teamName: string;
  status: string;
  activationStatus: string;
  activationErrorCode?: string | null;
  activationErrorMessage?: string | null;
  checkoutUrl?: string | null;
  expiresAt: string;
}
export interface CurrentTeamCheckoutResponse {
  intent?: TeamCheckoutIntentResponse | null;
}
export interface CloudWorkspaceSummary {
  id: string;
  targetId?: string | null;
  displayName: string | null;
  repo: RepoRef;
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
  origin?: CloudOriginContext | null;
  creatorContext?: CloudWorkspaceCreatorContext | null;
  directTargetContext?: CloudWorkspaceDirectTargetContext | null;
  visibility: CloudWorkspaceVisibility;
  exposure?: CloudWorkspaceExposureSummary | null;
  exposureState?: CloudWorkspaceExposureState;
  sandboxType?: CloudWorkspaceSandboxType;
  lastActivityAt?: string | null;
  lastSessionSummary?: CloudWorkspaceLastSessionSummary | null;
  claimedByUserId?: string | null;
  claimId?: string | null;
  claimedAt?: string | null;
  claimSourceKind?: string | null;
  billing?: components["schemas"]["WorkspaceBillingSummary"] | null;
  allowedAgentKinds?: string[];
  readyAgentKinds?: string[];
  anyharnessWorkspaceId?: string | null;
}
export type CloudWorkspaceDetail = Omit<
  components["schemas"]["WorkspaceDetail"],
  | "status"
  | "workspaceStatus"
  | "runtime"
  | "actionBlockKind"
  | "actionBlockReason"
  | "visibility"
> & {
  targetId?: string | null;
  status: CloudWorkspaceStatus;
  workspaceStatus: CloudWorkspaceStatus;
  productLifecycle?: CloudWorkspaceProductLifecycle;
  runtime?: CloudWorkspaceRuntimeSummary;
  executionTarget?: CloudWorkspaceExecutionTargetSummary;
  selectedMaterializationId?: string | null;
  primaryMaterialization?: CloudWorkspaceMaterializationSummary | null;
  cloudAccess?: CloudWorkspaceCloudAccessSummary;
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
  visibility: CloudWorkspaceVisibility;
  exposure?: CloudWorkspaceExposureSummary | null;
  exposureState?: CloudWorkspaceExposureState;
  sandboxType?: CloudWorkspaceSandboxType;
  lastActivityAt?: string | null;
  lastSessionSummary?: CloudWorkspaceLastSessionSummary | null;
};
export type ClaimWorkspaceRequest = components["schemas"]["ClaimWorkspaceRequest"];
export type ClaimWorkspaceResponse = components["schemas"]["ClaimWorkspaceResponse"];
export type DirectAccessTokenRequest =
  components["schemas"]["DirectAccessTokenRequest"];
export type DirectAccessTokenResponse =
  components["schemas"]["DirectAccessTokenResponse"];
export type RevokeClaimTokenResponse =
  components["schemas"]["RevokeClaimTokenResponse"];
export type CloudOriginContext        = components["schemas"]["OriginContext"];
export type CloudWorkspaceCreatorContext =
  components["schemas"]["WorkspaceCreatorContext"];
export type CloudWorkspaceDirectTargetContext =
  components["schemas"]["WorkspaceDirectTargetContext"];
export interface CloudConnectionInfo {
  runtimeUrl: string;
  accessToken: string;
  anyharnessWorkspaceId: string | null;
  runtimeGeneration: number;
  allowedAgentKinds: CloudAgentKind[];
  readyAgentKinds: string[];
  runtimeAuth: CloudRuntimeAuthState;
}
export type CloudGitRepositorySummary = components["schemas"]["CloudGitRepositorySummary"];
export type CloudGitRepositoriesResponse =
  components["schemas"]["CloudGitRepositoriesResponse"];
export type CloudRepoBranchesResponse = components["schemas"]["RepoBranchesResponse"];
export type CloudRepoConfigSummary    = components["schemas"]["CloudRepoConfigSummary"];
export type CloudRepoConfigsListResponse = components["schemas"]["CloudRepoConfigsListResponse"];
export type CloudRepoFileMetadata     = components["schemas"]["CloudRepoFileMetadata"];
export type CloudRepoConfigResponse   = components["schemas"]["CloudRepoConfigResponse"];
export type SaveCloudRepoConfigRequest = components["schemas"]["SaveCloudRepoConfigRequest"];
export type SaveOrganizationCloudRepoConfigRequest =
  components["schemas"]["SaveOrganizationCloudRepoConfigRequest"];
export type AutomationOwnerScope = "personal" | "organization";
export type AutomationTargetMode = "local" | "personal_cloud" | "shared_cloud";
export type AutomationRunStatus =
  | "queued"
  | "claimed"
  | "creating_workspace"
  | "provisioning_workspace"
  | "creating_session"
  | "dispatching"
  | "dispatched"
  | "failed"
  | "cancelled";
export interface AutomationResponse {
  id: string;
  ownerScope: AutomationOwnerScope;
  ownerUserId: string | null;
  organizationId: string | null;
  createdByUserId: string;
  gitOwner: string;
  gitRepoName: string;
  title: string;
  prompt: string;
  schedule: components["schemas"]["AutomationScheduleResponse"];
  targetMode: AutomationTargetMode;
  cloudAgentRunConfigId: string;
  enabled: boolean;
  pausedAt: string | null;
  lastScheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AutomationListResponse {
  automations: AutomationResponse[];
}
export interface AutomationRunResponse {
  id: string;
  automationId: string;
  ownerScope: AutomationOwnerScope;
  ownerUserId: string | null;
  organizationId: string | null;
  createdByUserId: string;
  triggerKind: "scheduled" | "manual";
  scheduledFor: string | null;
  targetMode: AutomationTargetMode;
  status: AutomationRunStatus;
  titleSnapshot: string;
  promptSnapshot: string;
  gitProviderSnapshot: string;
  gitOwnerSnapshot: string;
  gitRepoNameSnapshot: string;
  cloudRepoConfigIdSnapshot: string;
  cloudTargetIdSnapshot: string | null;
  cloudTargetKindSnapshot: string | null;
  sandboxProfileId: string | null;
  cloudWorkspaceExposureId: string | null;
  agentRunConfigSnapshot: Record<string, unknown> | null;
  cascadeAttempt: number;
  lastCascadeCommandId: string | null;
  lastCascadeReason: string | null;
  claimExpiresAt: string | null;
  dispatchStartedAt: string | null;
  dispatchedAt: string | null;
  failedAt: string | null;
  cloudWorkspaceId: string | null;
  anyharnessWorkspaceId: string | null;
  anyharnessSessionId: string | null;
  cancelledAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AutomationRunListResponse {
  runs: AutomationRunResponse[];
}
export interface CreateAutomationRequest {
  title: string;
  prompt: string;
  ownerScope?: AutomationOwnerScope;
  organizationId?: string | null;
  gitOwner: string;
  gitRepoName: string;
  schedule: components["schemas"]["AutomationScheduleRequest"];
  targetMode: AutomationTargetMode;
  cloudAgentRunConfigId: string;
}
export interface UpdateAutomationRequest {
  title?: string | null;
  prompt?: string | null;
  gitOwner?: string | null;
  gitRepoName?: string | null;
  schedule?: components["schemas"]["AutomationScheduleRequest"] | null;
  targetMode?: AutomationTargetMode | null;
  cloudAgentRunConfigId?: string | null;
}
export type LocalAutomationClaimRequest =
  components["schemas"]["LocalAutomationClaimRequest"];
export type LocalAutomationClaimActionRequest =
  components["schemas"]["LocalAutomationClaimActionRequest"];
export type LocalAutomationAttachWorkspaceRequest =
  components["schemas"]["LocalAutomationAttachWorkspaceRequest"];
export type LocalAutomationAttachSessionRequest =
  components["schemas"]["LocalAutomationAttachSessionRequest"];
export type LocalAutomationFailRequest =
  components["schemas"]["LocalAutomationFailRequest"];
export interface LocalAutomationRunClaimResponse {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  targetMode: AutomationTargetMode;
  titleSnapshot: string;
  promptSnapshot: string;
  gitProviderSnapshot: string;
  gitOwnerSnapshot: string;
  gitRepoNameSnapshot: string;
  cloudAgentRunConfigIdSnapshot: string | null;
  agentKindSnapshot: string | null;
  modelIdSnapshot: string | null;
  modeIdSnapshot: string | null;
  reasoningEffortSnapshot: string | null;
  claimId: string;
  claimExpiresAt: string;
  anyharnessWorkspaceId: string | null;
  anyharnessSessionId: string | null;
}
export interface LocalAutomationClaimListResponse {
  runs: LocalAutomationRunClaimResponse[];
}
export interface LocalAutomationMutationResponse {
  run: LocalAutomationRunClaimResponse | null;
  accepted: boolean;
}
export type CloudMcpCatalogResponse = components["schemas"]["ConnectorCatalogResponse"];
export type CloudMcpCatalogEntry = components["schemas"]["ConnectorCatalogEntryModel"];
export type CloudPluginPackage = components["schemas"]["PluginPackageModel"];
export type CloudPluginPackageSkill = components["schemas"]["PluginPackageSkillModel"];
export type CloudOrganizationIntegrationPolicyItem =
  components["schemas"]["CloudOrganizationIntegrationPolicyItem"];
export type CloudOrganizationIntegrationPolicyResponse =
  components["schemas"]["CloudOrganizationIntegrationPolicyResponse"];
export type PatchCloudOrganizationIntegrationPolicyRequest =
  components["schemas"]["PatchCloudOrganizationIntegrationPolicyRequest"];
export type CloudMcpConnection = components["schemas"]["CloudMcpConnectionResponse"];
export type CloudMcpConnectionsResponse = components["schemas"]["CloudMcpConnectionsResponse"];
export type CreateCloudMcpConnectionRequest =
  components["schemas"]["CreateCloudMcpConnectionRequest"];
export type PatchCloudMcpConnectionRequest =
  components["schemas"]["PatchCloudMcpConnectionRequest"];
export type PublicizeCloudMcpConnectionRequest =
  components["schemas"]["PublicizeCloudMcpConnectionRequest"];
export type PutCloudMcpSecretAuthRequest =
  components["schemas"]["PutCloudMcpSecretAuthRequest"];
export type CloudMcpOAuthFlowStatusResponse =
  components["schemas"]["CloudMcpOAuthFlowStatusResponse"];
export type StartCloudMcpOAuthFlowRequest =
  components["schemas"]["StartCloudMcpOAuthFlowRequest"];
export type StartCloudMcpOAuthFlowResponse =
  components["schemas"]["StartCloudMcpOAuthFlowResponse"];
export type CloudPluginConfiguredItem =
  components["schemas"]["PluginConfiguredItemResponse"];
export type CloudPluginConfiguredItemsResponse =
  components["schemas"]["PluginConfiguredItemsResponse"];
export type PatchPluginConfiguredItemRequest =
  components["schemas"]["PatchPluginConfiguredItemRequest"];
export type CloudSkillConfiguredItem =
  components["schemas"]["SkillConfiguredItemResponse"];
export type CloudSkillConfiguredItemsResponse =
  components["schemas"]["SkillConfiguredItemsResponse"];
export type CreateSkillConfiguredItemRequest =
  components["schemas"]["CreateSkillConfiguredItemRequest"];
export type PatchSkillConfiguredItemRequest =
  components["schemas"]["PatchSkillConfiguredItemRequest"];
export type PutCloudRepoFileRequest   = components["schemas"]["PutCloudRepoFileRequest"];
export interface CloudWorkspaceRepoConfigStatusResponse {
  currentRepoFilesVersion: number;
  repoFilesAppliedVersion: number;
  repoFilesAppliedAt: string | null;
  filesOutOfSync: boolean;
  trackedFiles: CloudRepoFileMetadata[];
  envVarKeys: string[];
  postReadyPhase: string;
  postReadyFilesTotal: number;
  postReadyFilesApplied: number;
  postReadyStartedAt: string | null;
  postReadyCompletedAt: string | null;
  lastApplyFailedPath: string | null;
  lastApplyError: string | null;
}
export interface ResyncCloudWorkspaceFilesResponse extends CloudWorkspaceRepoConfigStatusResponse {
  workspaceId: string;
}
export interface RunCloudWorkspaceSetupResponse {
  workspaceId: string;
  command: string;
  terminalId?: string | null;
  commandRunId?: string | null;
  status: string;
}
export type CloudWorktreeRetentionPolicyRequest =
  components["schemas"]["CloudWorktreeRetentionPolicyRequest"];
export type CloudWorktreeRetentionPolicyResponse =
  components["schemas"]["CloudWorktreeRetentionPolicyResponse"];
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
  requiredAgentKind?: string | null;
  source?: "desktop" | "web" | "mobile" | null;
}
export type GenerateSessionTitleRequest = components["schemas"]["GenerateSessionTitleRequest"];
export type GenerateSessionTitleResponse = components["schemas"]["GenerateSessionTitleResponse"];
export type GenerateWorkspaceNameRequest = components["schemas"]["GenerateWorkspaceNameRequest"];
export type GenerateWorkspaceNameResponse = components["schemas"]["GenerateWorkspaceNameResponse"];
export type SupportMessageContext     = components["schemas"]["SupportMessageContext"];
export type SendSupportMessageRequest = components["schemas"]["SupportMessageRequest"];
export type SupportReportCompleteRequest =
  components["schemas"]["SupportReportCompleteRequest"];
export type SupportReportCompleteResponse =
  components["schemas"]["SupportReportCompleteResponse"];
export type SupportReportCreateRequest =
  components["schemas"]["SupportReportCreateRequest"];
export type SupportReportCreateResponse =
  components["schemas"]["SupportReportCreateResponse"];
export type SupportReportServerCorrelation =
  components["schemas"]["SupportReportServerCorrelation"];
export type SupportReportTrackerResponse =
  components["schemas"]["SupportReportTrackerResponse"];
export type SupportReportUploadFile =
  components["schemas"]["SupportReportUploadFile"];
export type SupportReportUploadRequest =
  components["schemas"]["SupportReportUploadRequest"];
export type SupportReportUploadResponse =
  components["schemas"]["SupportReportUploadResponse"];
export type SupportReportUploadTargetsRequest =
  components["schemas"]["SupportReportUploadTargetsRequest"];
export type SupportReportWorkspaceReference =
  components["schemas"]["SupportReportWorkspaceReference"];
export type CloudMobilityRepoRef = components["schemas"]["MobilityRepoRef"];
export type CloudMobilityHandoffSummary = components["schemas"]["MobilityHandoffSummary"];
export type CloudMobilityWorkspaceSummary = components["schemas"]["MobilityWorkspaceSummary"];
export type CloudMobilityWorkspaceDetail = components["schemas"]["MobilityWorkspaceDetail"];
export type EnsureCloudMobilityWorkspaceRequest =
  components["schemas"]["EnsureMobilityWorkspaceRequest"];
export type CloudWorkspaceMobilityPreflightRequest =
  components["schemas"]["WorkspaceMobilityPreflightRequest"];
export type CloudWorkspaceMobilityPreflightResponse =
  components["schemas"]["WorkspaceMobilityPreflightResponse"];
export type StartCloudWorkspaceMobilityHandoffRequest =
  components["schemas"]["StartWorkspaceMobilityHandoffRequest"];
export type UpdateCloudWorkspaceMobilityHandoffPhaseRequest =
  components["schemas"]["UpdateWorkspaceMobilityHandoffPhaseRequest"];
export type FinalizeCloudWorkspaceMobilityHandoffRequest =
  components["schemas"]["FinalizeWorkspaceMobilityHandoffRequest"];
export type FailCloudWorkspaceMobilityHandoffRequest =
  components["schemas"]["FailWorkspaceMobilityHandoffRequest"];
export type CloudMobilityCleanupItemSummary =
  components["schemas"]["MobilityCleanupItemSummary"];
export type FailCloudMobilityCleanupItemRequest =
  components["schemas"]["FailMobilityCleanupItemRequest"];
export type RepairCloudWorkspaceMobilityHandoffRequest =
  components["schemas"]["RepairWorkspaceMobilityHandoffRequest"];
export type CloudAgentCatalogResponse = components["schemas"]["AgentCatalogResponse"];
export type CloudAgentCatalogAgent = components["schemas"]["AgentCatalogAgent"];
export type CloudAgentCatalogSession = components["schemas"]["AgentCatalogSession"];
export type CloudAgentCatalogModel = components["schemas"]["AgentCatalogModel"];
export type CloudAgentCatalogModelControl =
  components["schemas"]["AgentCatalogModelControl"];
export type CloudAgentCatalogSessionControl =
  components["schemas"]["AgentCatalogSessionControl"];
export type CloudAgentCatalogControlMapping =
  components["schemas"]["AgentCatalogControlMapping"];
export type CloudAgentCatalogAuthContext =
  components["schemas"]["AgentCatalogAuthContext"];
export type CloudAgentCatalogAvailability =
  components["schemas"]["AgentCatalogAvailability"];
export type CloudAgentCatalogHarnessPins =
  components["schemas"]["AgentCatalogHarnessPins"];
export type CloudTargetConfig = components["schemas"]["CloudTargetConfigResponse"];
export type TargetConfigSummary = components["schemas"]["TargetConfigSummaryModel"];
export type MaterializeTargetConfigRequest =
  components["schemas"]["MaterializeTargetConfigRequest"];
export type MaterializeTargetConfigResponse =
  components["schemas"]["MaterializeTargetConfigResponse"];
export type RefreshRuntimeConfigRequest =
  components["schemas"]["RefreshRuntimeConfigRequest"];
export type RuntimeConfigRevision = components["schemas"]["RuntimeConfigRevisionModel"];
export type RuntimeConfigStatusResponse =
  components["schemas"]["RuntimeConfigStatusResponse"];
export type RuntimeConfigMaterializationFragment =
  components["schemas"]["RuntimeConfigMaterializationFragment"];
