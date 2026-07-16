import type { Schema } from "./schema.js";

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

// Placement-neutral backing kind for a lightweight cloud workspace. A
// repository worktree carries real repository metadata; a scratch workspace has
// no repository backing (managed Workflow runs) and serializes repo/
// repoEnvironmentId as null. Absent (older servers) is treated as
// repositoryWorktree by the product-domain derivation.
export type CloudWorkspaceBackingKind = "repositoryWorktree" | "scratch";

export type CloudWorkspaceProductLifecycle = "active" | "archived" | "deleted";
export type CloudWorkspaceExecutionTargetKind =
  | "local_desktop"
  | "managed_cloud"
  | "ssh"
  | "self_hosted";
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

// Derived from the generated OpenAPI schema — the wire contract is the source of
// truth. Do not hand-copy fields here.
export type CloudWorkspaceMaterializationSummary = Schema<"WorkspaceMaterializationSummary">;
export type CloudWorkspaceMaterializationState =
  CloudWorkspaceMaterializationSummary["state"];
export type CloudWorkspaceMaterializationTargetKind =
  CloudWorkspaceMaterializationSummary["targetKind"];
export type CreateMaterializationIntentRequest =
  Schema<"CreateMaterializationIntentRequest">;
export type MaterializationIntentResponse = Schema<"MaterializationIntentResponse">;
export type MaterializationIntentSource = Schema<"MaterializationIntentSource">;
export type ReportMaterializationRequest = Schema<"ReportMaterializationRequest">;

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

export interface CloudWorkspaceRuntimeSummary {
  environmentId: string | null;
  status: CloudRuntimeStatus;
  generation: number;
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
}

export type CloudAgentKind = "claude" | "codex" | "opencode" | "grok";

export function isCloudAgentKind(value: string): value is CloudAgentKind {
  return value === "claude" || value === "codex" || value === "opencode" || value === "grok";
}

// Generated type aliases — names preserved so all existing import sites are unchanged.
export type RepoRef                   = Schema<"RepoRef">;
export type CloudSandboxResponse    = Schema<"CloudSandboxResponse">;
export type BillingPlanInfo           = Schema<"CloudPlanInfo">;
export type BillingUrlResponse        = Schema<"BillingUrlResponse">;
export type OverageSettingsResponse   = Schema<"OverageSettingsResponse">;
export type BillingOwnerSelection     = Schema<"BillingOwnerSelection">;
export type UsageSummary              = Schema<"UsageSummary">;
export type UsageTimeseries           = Schema<"UsageTimeseries">;
export type UsageTimeseriesBucket     = Schema<"UsageTimeseriesBucket">;
export type BudgetLimitWindowUsage    = Schema<"BudgetLimitWindowUsage">;
export type LlmBalance                = Schema<"LlmBalance">;
export type BudgetLimit               = Schema<"BudgetLimit">;
export type BudgetLimitInput          = Schema<"BudgetLimitInput">;
export type BudgetLimitsResponse      = Schema<"BudgetLimitsResponse">;
export type OrgUserUsageRow           = Schema<"OrgUserUsageRow">;
export type OrgUsageByUserResponse    = Schema<"OrgUsageByUserResponse">;
export type OrgUserUsageTimeseriesResponse =
  Schema<"OrgUserUsageTimeseriesResponse">;
export type OrganizationUpdateRequest = Schema<"OrganizationUpdateRequest">;
export type OrganizationInviteRequest = Schema<"OrganizationInviteRequest">;
export type OrganizationMembershipUpdateRequest =
  Schema<"OrganizationMembershipUpdateRequest">;
export type OrganizationInvitationAcceptRequest =
  Schema<"OrganizationInvitationAcceptRequest">;
export type OrganizationStatus = "pending_checkout" | "active" | "suspended" | "archived";
export type OrganizationResponse = Schema<"OrganizationResponse"> & {
  status: OrganizationStatus;
};
export type OrganizationListResponse = Omit<
  Schema<"OrganizationListResponse">,
  "organizations"
> & {
  organizations: OrganizationResponse[];
};
export type OrganizationMemberResponse =
  Schema<"OrganizationMemberResponse">;
export type OrganizationMembersResponse =
  Schema<"OrganizationMembersResponse">;
export type OrganizationMembershipResponse =
  Schema<"OrganizationMembershipResponse">;
export type OrganizationInvitationResponse =
  Schema<"OrganizationInvitationResponse">;
export type OrganizationInvitationsResponse =
  Schema<"OrganizationInvitationsResponse">;
export type OrganizationJoinLinkResponse =
  Schema<"OrganizationJoinLinkResponse">;
export type OrganizationInvitationAcceptResponse =
  Schema<"OrganizationInvitationAcceptResponse">;
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
// App-carried extras that this branch's server ``WorkspaceSummary`` does NOT
// emit on the wire. These are populated by app/aggregation code and other
// product surfaces (mobile last-session projection, billing, exposure/claim
// projections, origin/creator context threaded from #1245-era needs) — the
// cloud-workspace wire contract on this branch carries none of them. They are
// the only genuinely hand-maintained members of ``CloudWorkspaceSummary``;
// everything the wire carries is derived from ``Schema<"WorkspaceSummary">``
// below. If the server model starts emitting one of these, move it out of this
// overlay and let it derive from the regenerated schema.
interface CloudWorkspaceSummaryAppExtras {
  repoFilesLastFailedPath?: string | null;
  origin?: CloudOriginContext | null;
  creatorContext?: CloudWorkspaceCreatorContext | null;
  directTargetContext?: CloudWorkspaceDirectTargetContext | null;
  exposure?: CloudWorkspaceExposureSummary | null;
  lastSessionSummary?: CloudWorkspaceLastSessionSummary | null;
  claimedByUserId?: string | null;
  claimId?: string | null;
  claimedAt?: string | null;
  claimSourceKind?: string | null;
  billing?: Schema<"WorkspaceBillingSummary"> | null;
}

// Derived from the generated OpenAPI ``WorkspaceSummary`` — the wire contract is
// the source of truth. We override only the SDK's normalized display fields,
// which product surfaces consume as their full domain unions rather than the
// narrow subset this one server emits: the two status enums (SDK client
// normalizes into ``CloudWorkspaceStatus`` — adds ``needs_rematerialization``/
// ``pending``), and ``visibility``/``sandboxType``/``exposureState`` (workspaces
// arrive from multiple scopes — exposed/org-all/claimable — so the client treats
// these as the richer product unions). This is exactly the "existing normalized
// status fields" overlay the PR spec's conformance section permits; no unrelated
// wire field (materializations, runtime, cloudAccess, executionTarget, …) is
// duplicated here.
// ``Required<>`` over the wire base: the generated schema marks most fields
// optional because they carry Pydantic defaults, but the server always
// serializes them, and product consumers rely on their present-but-nullable
// shape (matching the prior hand-written mirror). Off-wire app extras stay
// optional via the separate intersection below.
export type CloudWorkspaceSummary = Required<
  Omit<
    Schema<"WorkspaceSummary">,
    | "status"
    | "workspaceStatus"
    | "visibility"
    | "sandboxType"
    | "exposureState"
    | "runtime"
    | "executionTarget"
  >
> & {
  status: CloudWorkspaceStatus;
  workspaceStatus: CloudWorkspaceStatus;
  visibility: CloudWorkspaceVisibility;
  sandboxType?: CloudWorkspaceSandboxType;
  exposureState?: CloudWorkspaceExposureState;
  // Runtime status is the SDK's normalized ``CloudRuntimeStatus`` (adds
  // ``provisioning``), the same normalized-status overlay as ``status``.
  runtime?: CloudWorkspaceRuntimeSummary;
  // executionTarget.kind is the full target-kind union the product consumes
  // (local_desktop | managed_cloud | ssh | self_hosted); this one server only
  // ever emits the managed_cloud constant, so keep the richer SDK shape.
  executionTarget?: CloudWorkspaceExecutionTargetSummary;
} & CloudWorkspaceSummaryAppExtras;

export type CloudWorkspaceDetail = CloudWorkspaceSummary & {
  [key: string]: unknown;
};
export type CloudWorkspaceRuntimeStatusResponse =
  Schema<"CloudWorkspaceRuntimeStatusResponse">;
export type ClaimWorkspaceRequest = Schema<"ClaimWorkspaceRequest">;
export type ClaimWorkspaceResponse = Schema<"ClaimWorkspaceResponse">;
export type DirectAccessTokenRequest =
  Schema<"DirectAccessTokenRequest">;
export type DirectAccessTokenResponse =
  Schema<"DirectAccessTokenResponse">;
export type RevokeClaimTokenResponse =
  Schema<"RevokeClaimTokenResponse">;
export type CloudOriginContext        = Schema<"OriginContext">;
export type CloudWorkspaceCreatorContext =
  Schema<"WorkspaceCreatorContext">;
export type CloudWorkspaceDirectTargetContext =
  Schema<"WorkspaceDirectTargetContext">;
export interface CloudConnectionInfo {
  runtimeUrl: string;
  accessToken: string;
  anyharnessWorkspaceId: string | null;
  runtimeGeneration: number;
  allowedAgentKinds: CloudAgentKind[];
  readyAgentKinds: string[];
}
export type CloudGitRepositorySummary = Schema<"CloudGitRepositorySummary">;
export type CloudGitRepositoriesResponse =
  Schema<"CloudGitRepositoriesResponse">;
export type CloudRepoBranchesResponse = Schema<"RepoBranchesResponse">;
export type RepoEnvironmentMaterializationStatus =
  Schema<"CloudMaterializationStatus">;
export type RepoEnvironmentMaterializationResponse =
  Schema<"RepoEnvironmentMaterializationResponse">;
export type RepoEnvironmentResponse = Schema<"RepoEnvironmentResponse">;
export type RepoConfigResponse = Schema<"RepoConfigResponse">;
export type RepoConfigsListResponse = Schema<"RepoConfigsListResponse">;
export type SaveRepoEnvironmentRequest = Schema<"SaveRepoEnvironmentRequest">;
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
  schedule: Schema<"AutomationScheduleResponse">;
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
  schedule: Schema<"AutomationScheduleRequest">;
  targetMode: AutomationTargetMode;
  cloudAgentRunConfigId: string;
}
export interface UpdateAutomationRequest {
  title?: string | null;
  prompt?: string | null;
  gitOwner?: string | null;
  gitRepoName?: string | null;
  schedule?: Schema<"AutomationScheduleRequest"> | null;
  targetMode?: AutomationTargetMode | null;
  cloudAgentRunConfigId?: string | null;
}
export type LocalAutomationClaimRequest =
  Schema<"LocalAutomationClaimRequest">;
export type LocalAutomationClaimActionRequest =
  Schema<"LocalAutomationClaimActionRequest">;
export type LocalAutomationAttachWorkspaceRequest =
  Schema<"LocalAutomationAttachWorkspaceRequest">;
export type LocalAutomationAttachSessionRequest =
  Schema<"LocalAutomationAttachSessionRequest">;
export type LocalAutomationFailRequest =
  Schema<"LocalAutomationFailRequest">;
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
export interface CloudMcpCatalogField {
  id: string;
  label: string;
  placeholder: string;
  helperText: string;
  getTokenInstructions: string;
  prefixHint?: string | null;
}
export interface CloudMcpSettingsOption {
  value: string;
  label: string;
}
export interface CloudMcpSettingsField {
  id: string;
  kind: "string" | "boolean" | "select" | "url";
  label: string;
  placeholder?: string | null;
  helperText?: string | null;
  required: boolean;
  defaultValue?: string | boolean | null;
  options?: CloudMcpSettingsOption[] | null;
  affectsUrl: boolean;
}
export type CloudMcpArgTemplateSource =
  | { kind: "static"; value: string }
  | { kind: "workspace_path" }
  | { kind: "secret"; fieldId: string }
  | { kind: "setting"; fieldId: string };
export type CloudMcpEnvTemplateSource =
  | { kind: "static"; value: string }
  | { kind: "secret"; fieldId: string }
  | { kind: "setting"; fieldId: string };
export type CloudMcpTemplateSource = CloudMcpArgTemplateSource | CloudMcpEnvTemplateSource;
export interface CloudMcpCatalogEntry {
  id: string;
  version: number;
  name: string;
  oneLiner: string;
  description: string;
  docsUrl: string;
  availability: "universal" | "local_only" | "cloud_only";
  cloudSecretSync: boolean;
  setupKind: "none" | "local_oauth";
  serverNameBase: string;
  iconId: string;
  displayUrl?: string | null;
  oauthClientMode?: "dcr" | "static" | null;
  secretFields?: CloudMcpCatalogField[] | null;
  requiredFields: CloudMcpCatalogField[];
  settingsSchema?: CloudMcpSettingsField[] | null;
  capabilities: string[];
  transport: "stdio" | "http";
  command?: string | null;
  args?: Array<{ source: CloudMcpArgTemplateSource }> | null;
  env?: Array<{ name: string; source: CloudMcpEnvTemplateSource }> | null;
  authKind: "secret" | "oauth" | "none";
  authStyle?: (
    | { kind: "bearer" }
    | { kind: "header"; headerName?: string | null }
    | { kind: "query"; parameterName?: string | null }
  ) | null;
  authFieldId?: string | null;
  url: string;
}
export interface CloudPluginPackageSkill {
  id: string;
  displayName: string;
  description: string;
  instructions: string;
  requiredMcpServerRefs?: string[];
  requiresCredentialBinding: boolean;
  resources?: Array<{
    resourceId: string;
    displayName?: string | null;
    contentType: string;
    content: string;
  }>;
  defaultEnabled: boolean;
  provenance?: {
    sourceRepoUrl: string;
    sourcePath: string;
    sourceRef: string;
    sourceSha256: string;
    adaptedSha256: string;
    sourceLicense: string;
    importMode: "adapted" | "vendored";
    reviewStatus: "reviewed" | "pending";
    reviewer: string;
    reviewedAt: string;
    notes?: string | null;
  };
}
export interface CloudPluginPackage {
  id: string;
  catalogEntryId: string;
  version: string;
  displayName: string;
  description: string;
  skills?: CloudPluginPackageSkill[];
}
export interface CloudMcpCatalogResponse {
  entries: CloudMcpCatalogEntry[];
  pluginPackages?: CloudPluginPackage[];
}
export type CloudOrganizationIntegrationPolicyItem =
  Schema<"CloudOrganizationIntegrationPolicyItem">;
export type CloudOrganizationIntegrationPolicyResponse =
  Schema<"CloudOrganizationIntegrationPolicyResponse">;
export type PatchCloudOrganizationIntegrationPolicyRequest =
  Schema<"PatchCloudOrganizationIntegrationPolicyRequest">;
export interface CloudMcpConnection {
  connectionId: string;
  catalogEntryId: string;
  catalogEntryVersion: number;
  ownerScope: string;
  ownerUserId?: string | null;
  organizationId?: string | null;
  enabled: boolean;
  serverName: string;
  authStatus: string;
  settings: Record<string, unknown>;
  publicToOrg: boolean;
  publicOrganizationId?: string | null;
  publicStatus: string;
  publicUpdatedAt?: string | null;
  publicUpdatedByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}
export interface CloudMcpConnectionsResponse {
  connections: CloudMcpConnection[];
}
export type CreateCloudMcpConnectionRequest =
  Schema<"CreateCloudMcpConnectionRequest">;
export type PatchCloudMcpConnectionRequest =
  Schema<"PatchCloudMcpConnectionRequest">;
export type PublicizeCloudMcpConnectionRequest =
  Schema<"PublicizeCloudMcpConnectionRequest">;
export type PutCloudMcpSecretAuthRequest =
  Schema<"PutCloudMcpSecretAuthRequest">;
export type CloudMcpOAuthFlowStatusResponse =
  Schema<"CloudMcpOAuthFlowStatusResponse">;
export type StartCloudMcpOAuthFlowRequest =
  Schema<"StartCloudMcpOAuthFlowRequest">;
export type StartCloudMcpOAuthFlowResponse =
  Schema<"StartCloudMcpOAuthFlowResponse">;
export interface CloudPluginConfiguredItem {
  id: string;
  pluginId: string;
  pluginVersion?: string | null;
  enabled: boolean;
  ownerScope: string;
  ownerUserId?: string | null;
  organizationId?: string | null;
  publicToOrg: boolean;
  publicOrganizationId?: string | null;
  publicStatus: string;
  configVersion?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}
export interface CloudPluginConfiguredItemsResponse {
  plugins: CloudPluginConfiguredItem[];
}
export type PatchPluginConfiguredItemRequest =
  Schema<"PatchPluginConfiguredItemRequest">;
export interface CloudSkillConfiguredItem {
  id: string;
  skillId: string;
  skillSourceKind?: string | null;
  skillVersion?: string | null;
  pluginId?: string | null;
  pluginVersion?: string | null;
  enabled: boolean;
  ownerScope: string;
  ownerUserId?: string | null;
  organizationId?: string | null;
  publicToOrg: boolean;
  publicOrganizationId?: string | null;
  publicStatus: string;
  configVersion?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}
export interface CloudSkillConfiguredItemsResponse {
  skills: CloudSkillConfiguredItem[];
}
export type CreateSkillConfiguredItemRequest =
  Schema<"CreateSkillConfiguredItemRequest">;
export type PatchSkillConfiguredItemRequest =
  Schema<"PatchSkillConfiguredItemRequest">;
export type CloudWorktreeRetentionPolicyRequest =
  Schema<"CloudWorktreeRetentionPolicyRequest">;
export type CloudWorktreeRetentionPolicyResponse =
  Schema<"CloudWorktreeRetentionPolicyResponse">;
export interface CreateCloudWorkspaceRequest {
  gitProvider: "github";
  gitOwner: string;
  gitRepoName: string;
  baseBranch?: string | null;
  branchName: string;
  displayName?: string | null;
  generatedName?: boolean | null;
  source?: "desktop" | "web" | "mobile" | null;
}
export type GenerateSessionTitleRequest = Schema<"GenerateSessionTitleRequest">;
export type GenerateSessionTitleResponse = Schema<"GenerateSessionTitleResponse">;
export type GenerateWorkspaceNameRequest = Schema<"GenerateWorkspaceNameRequest">;
export type GenerateWorkspaceNameResponse = Schema<"GenerateWorkspaceNameResponse">;
export type GenerateCommitMessageRequest = Schema<"GenerateCommitMessageRequest">;
export type GenerateCommitMessageResponse = Schema<"GenerateCommitMessageResponse">;
export type UpdateRepoConfigRequest = Schema<"UpdateRepoConfigRequest">;
export type UserRead              = Schema<"UserRead">;
export type ProfileUpdateRequest  = Schema<"ProfileUpdateRequest">;
export type SupportMessageContext     = Schema<"SupportMessageContext">;
export type SendSupportMessageRequest = Schema<"SupportMessageRequest">;
export type SupportReportCompleteRequest =
  Schema<"SupportReportCompleteRequest">;
export type SupportReportCompleteResponse =
  Schema<"SupportReportCompleteResponse">;
export type SupportReportCreateRequest =
  Schema<"SupportReportCreateRequest">;
export type SupportReportCreateResponse =
  Schema<"SupportReportCreateResponse">;
export type SupportReportServerCorrelation =
  Schema<"SupportReportServerCorrelation">;
export type SupportReportTrackerResponse =
  Schema<"SupportReportTrackerResponse">;
export type SupportReportUploadRequest =
  Schema<"SupportReportUploadRequest">;
export interface SupportReportUploadFile {
  clientFileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}
export interface SupportReportUploadTarget {
  clientFileId?: string | null;
  objectKey: string;
  putUrl: string;
  contentType: string;
  headers?: Record<string, string>;
}
export interface SupportReportUploadResponse {
  reportId: string;
  diagnostics?: SupportReportUploadTarget | null;
  attachments?: SupportReportUploadTarget[];
}
export interface SupportReportUploadTargetsRequest {
  diagnostics?: {
    contentType: string;
    sizeBytes: number;
    sha256: string;
  } | null;
  attachments?: Array<{
    clientFileId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }>;
}
export type SupportReportWorkspaceReference =
  Schema<"SupportReportWorkspaceReference">;
export interface CloudMobilityRepoRef {
  provider: string;
  owner: string;
  name: string;
  branch: string;
}
export interface CloudMobilityHandoffSummary {
  id: string;
  direction: "local_to_cloud" | "cloud_to_local";
  sourceOwner: string;
  targetOwner: string;
  status: string;
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
  canonicalSide?: "source" | "destination" | null;
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
export interface CloudMobilityWorkspaceDetail extends CloudMobilityWorkspaceSummary {
  [key: string]: unknown;
}
export type EnsureCloudMobilityWorkspaceRequest =
  Schema<"EnsureMobilityWorkspaceRequest">;
export type CloudWorkspaceMobilityPreflightRequest =
  Schema<"WorkspaceMobilityPreflightRequest">;
export type CloudWorkspaceMobilityPreflightResponse =
  Schema<"WorkspaceMobilityPreflightResponse">;
export type StartCloudWorkspaceMobilityHandoffRequest =
  Schema<"StartWorkspaceMobilityHandoffRequest">;
export type UpdateCloudWorkspaceMobilityHandoffPhaseRequest =
  Schema<"UpdateWorkspaceMobilityHandoffPhaseRequest">;
export type FinalizeCloudWorkspaceMobilityHandoffRequest =
  Schema<"FinalizeWorkspaceMobilityHandoffRequest">;
export type FailCloudWorkspaceMobilityHandoffRequest =
  Schema<"FailWorkspaceMobilityHandoffRequest">;
export type CloudMobilityCleanupItemSummary =
  Schema<"MobilityCleanupItemSummary">;
export type FailCloudMobilityCleanupItemRequest =
  Schema<"FailMobilityCleanupItemRequest">;
export type RepairCloudWorkspaceMobilityHandoffRequest =
  Schema<"RepairWorkspaceMobilityHandoffRequest">;
export type CloudAgentCatalogResponse = Schema<"AgentCatalogResponse">;
export type CloudAgentCatalogAgent = Schema<"AgentCatalogAgent">;
export type CloudAgentCatalogSession = Schema<"AgentCatalogSession">;
export type CloudAgentCatalogModel = Schema<"AgentCatalogModel">;
export type CloudAgentCatalogModelControl =
  Schema<"AgentCatalogModelControl">;
export type CloudAgentCatalogSessionControl =
  Schema<"AgentCatalogSessionControl">;
export type CloudAgentCatalogControlMapping =
  Schema<"AgentCatalogControlMapping">;
export type CloudAgentCatalogAuthContext =
  Schema<"AgentCatalogAuthContext">;
export type CloudAgentCatalogAvailability =
  Schema<"AgentCatalogAvailability">;
export type CloudAgentCatalogHarnessPins =
  Schema<"AgentCatalogHarnessPins">;
export type CloudTargetConfig = Schema<"CloudTargetConfigResponse">;
export type TargetConfigSummary = Schema<"TargetConfigSummaryModel">;
export type MaterializeTargetConfigRequest =
  Schema<"MaterializeTargetConfigRequest">;
export type MaterializeTargetConfigResponse =
  Schema<"MaterializeTargetConfigResponse">;
export type RefreshRuntimeConfigRequest =
  Schema<"RefreshRuntimeConfigRequest">;
export type RuntimeConfigRevision = Schema<"RuntimeConfigRevisionModel">;
export type RuntimeConfigStatusResponse =
  Schema<"RuntimeConfigStatusResponse">;
export type RuntimeConfigMaterializationFragment =
  Schema<"RuntimeConfigMaterializationFragment">;
