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

export type CloudAgentKind = "claude" | "codex" | "gemini";

export function isCloudAgentKind(value: string): value is CloudAgentKind {
  return value === "claude" || value === "codex" || value === "gemini";
}

// Generated type aliases — names preserved so all existing import sites are unchanged.
export type RepoRef                   = components["schemas"]["RepoRef"];
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
export type OrganizationResponse = components["schemas"]["OrganizationResponse"];
export type OrganizationListResponse = components["schemas"]["OrganizationListResponse"];
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
export type OrganizationInvitationAcceptResponse =
  components["schemas"]["OrganizationInvitationAcceptResponse"];
export type CloudWorkspaceSummary = Omit<
  components["schemas"]["WorkspaceSummary"],
  | "status"
  | "workspaceStatus"
  | "runtime"
  | "actionBlockKind"
  | "actionBlockReason"
  | "visibility"
> & {
  status: CloudWorkspaceStatus;
  workspaceStatus: CloudWorkspaceStatus;
  runtime?: CloudWorkspaceRuntimeSummary;
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
  visibility: CloudWorkspaceVisibility;
};
export type CloudWorkspaceDetail = Omit<
  components["schemas"]["WorkspaceDetail"],
  | "status"
  | "workspaceStatus"
  | "runtime"
  | "actionBlockKind"
  | "actionBlockReason"
  | "visibility"
> & {
  status: CloudWorkspaceStatus;
  workspaceStatus: CloudWorkspaceStatus;
  runtime?: CloudWorkspaceRuntimeSummary;
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
  visibility: CloudWorkspaceVisibility;
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
export type CloudConnectionInfo       = components["schemas"]["WorkspaceConnection"];
export type CloudRepoBranchesResponse = components["schemas"]["RepoBranchesResponse"];
export type CloudRepoConfigSummary    = components["schemas"]["CloudRepoConfigSummary"];
export type CloudRepoConfigsListResponse = components["schemas"]["CloudRepoConfigsListResponse"];
export type CloudRepoFileMetadata     = components["schemas"]["CloudRepoFileMetadata"];
export type CloudRepoConfigResponse   = components["schemas"]["CloudRepoConfigResponse"];
export type SaveCloudRepoConfigRequest = components["schemas"]["SaveCloudRepoConfigRequest"];
export type AutomationResponse = components["schemas"]["AutomationResponse"];
export type AutomationListResponse = components["schemas"]["AutomationListResponse"];
export type AutomationRunResponse = components["schemas"]["AutomationRunResponse"];
export type AutomationRunListResponse = components["schemas"]["AutomationRunListResponse"];
export type CreateAutomationRequest = components["schemas"]["CreateAutomationRequest"];
export type UpdateAutomationRequest = components["schemas"]["UpdateAutomationRequest"];
export type LocalAutomationClaimRequest =
  components["schemas"]["LocalAutomationClaimRequest"];
export type LocalAutomationClaimListResponse =
  components["schemas"]["LocalAutomationClaimListResponse"];
export type LocalAutomationClaimActionRequest =
  components["schemas"]["LocalAutomationClaimActionRequest"];
export type LocalAutomationAttachWorkspaceRequest =
  components["schemas"]["LocalAutomationAttachWorkspaceRequest"];
export type LocalAutomationAttachSessionRequest =
  components["schemas"]["LocalAutomationAttachSessionRequest"];
export type LocalAutomationFailRequest =
  components["schemas"]["LocalAutomationFailRequest"];
export type LocalAutomationMutationResponse =
  components["schemas"]["LocalAutomationMutationResponse"];
export type LocalAutomationRunClaimResponse =
  components["schemas"]["LocalAutomationRunClaimResponse"];
export type CloudMcpCatalogResponse = components["schemas"]["ConnectorCatalogResponse"];
export type CloudMcpCatalogEntry = components["schemas"]["ConnectorCatalogEntryModel"];
export type CloudPluginPackage = components["schemas"]["PluginPackageModel"];
export type CloudPluginPackageSkill = components["schemas"]["PluginPackageSkillModel"];
export type CloudMcpConnection = components["schemas"]["CloudMcpConnectionResponse"];
export type CloudMcpConnectionsResponse = components["schemas"]["CloudMcpConnectionsResponse"];
export type CreateCloudMcpConnectionRequest =
  components["schemas"]["CreateCloudMcpConnectionRequest"];
export type PatchCloudMcpConnectionRequest =
  components["schemas"]["PatchCloudMcpConnectionRequest"];
export type PutCloudMcpSecretAuthRequest =
  components["schemas"]["PutCloudMcpSecretAuthRequest"];
export type CloudMcpOAuthFlowStatusResponse =
  components["schemas"]["CloudMcpOAuthFlowStatusResponse"];
export type StartCloudMcpOAuthFlowResponse =
  components["schemas"]["StartCloudMcpOAuthFlowResponse"];
export type PutCloudRepoFileRequest   = components["schemas"]["PutCloudRepoFileRequest"];
export type CloudWorkspaceRepoConfigStatusResponse = components["schemas"]["CloudWorkspaceRepoConfigStatusResponse"];
export type ResyncCloudWorkspaceFilesResponse = components["schemas"]["ResyncCloudWorkspaceFilesResponse"];
export type RunCloudWorkspaceSetupResponse = components["schemas"]["RunCloudWorkspaceSetupResponse"];
export type CloudWorktreeRetentionPolicyRequest =
  components["schemas"]["CloudWorktreeRetentionPolicyRequest"];
export type CloudWorktreeRetentionPolicyResponse =
  components["schemas"]["CloudWorktreeRetentionPolicyResponse"];
export type CreateCloudWorkspaceRequest = components["schemas"]["CreateCloudWorkspaceRequest"];
export type GenerateSessionTitleRequest = components["schemas"]["GenerateSessionTitleRequest"];
export type GenerateSessionTitleResponse = components["schemas"]["GenerateSessionTitleResponse"];
export type SupportMessageContext     = components["schemas"]["SupportMessageContext"];
export type SendSupportMessageRequest = components["schemas"]["SupportMessageRequest"];
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
export type CloudAgentCatalogResponse = components["schemas"]["AgentCatalogResponse"];
export type CloudAgentCatalogAgent = components["schemas"]["AgentCatalogAgent"];
export type CloudAgentCatalogSession = components["schemas"]["AgentCatalogSession"];
export type CloudAgentCatalogModel = components["schemas"]["AgentCatalogModel"];
export type CloudAgentCatalogControl = components["schemas"]["AgentCatalogControl"];
export type CloudAgentCatalogControlValue =
  components["schemas"]["AgentCatalogControlValue"];
export type CloudAgentCatalogLaunchRemediation =
  components["schemas"]["AgentCatalogLaunchRemediation"];
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
