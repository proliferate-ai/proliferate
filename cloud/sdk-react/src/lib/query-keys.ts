export function cloudRootKey() {
  return ["cloud"] as const;
}

export function authRootKey() {
  return ["auth"] as const;
}

export function authViewerKey(apiBaseUrl: string, authCacheScope = "default") {
  return [...authRootKey(), "viewer", apiBaseUrl, authCacheScope] as const;
}

export function controlPlaneHealthKey(apiBaseUrl: string) {
  return [...cloudRootKey(), "control-plane-health", apiBaseUrl] as const;
}

export function agentAuthRootKey() {
  return [...cloudRootKey(), "agent-auth"] as const;
}

export function cloudCapabilitiesKey() {
  return [...cloudRootKey(), "capabilities"] as const;
}

export function cloudAgentCatalogKey() {
  return [...cloudRootKey(), "agent-catalog", "v1"] as const;
}

export function cloudPluginInventoryRootKey() {
  return [...cloudRootKey(), "plugin-inventory"] as const;
}

export function cloudMcpCatalogKey() {
  return [...cloudPluginInventoryRootKey(), "mcp-catalog", "v1"] as const;
}

export function cloudOrganizationIntegrationPolicyKey(
  organizationId: string | null,
) {
  return [
    ...cloudPluginInventoryRootKey(),
    "organization-integration-policy",
    organizationId,
  ] as const;
}

export function organizationSsoConnectionsKey(organizationId: string | null) {
  return [...cloudRootKey(), "organizations", organizationId, "sso-connections"] as const;
}

export function cloudMcpConnectionsKey() {
  return [...cloudPluginInventoryRootKey(), "mcp-connections"] as const;
}

export function cloudMcpOAuthFlowKey(flowId: string | null) {
  return [...cloudPluginInventoryRootKey(), "mcp-oauth-flow", flowId] as const;
}

export function cloudConfiguredPluginsKey() {
  return [...cloudPluginInventoryRootKey(), "configured-plugins"] as const;
}

export function cloudConfiguredSkillsKey() {
  return [...cloudPluginInventoryRootKey(), "configured-skills"] as const;
}

export function agentAuthCredentialsKey(
  organizationId: string | null = null,
  credentialProviderId: string | null = null,
) {
  return [
    ...agentAuthRootKey(),
    "credentials",
    organizationId,
    credentialProviderId,
  ] as const;
}

export function sandboxProfileKey(sandboxProfileId: string | null) {
  return [...agentAuthRootKey(), "sandbox-profile", sandboxProfileId] as const;
}

export function sandboxAgentAuthSelectionsKey(sandboxProfileId: string | null) {
  return [...sandboxProfileKey(sandboxProfileId), "selections"] as const;
}

export function sandboxAgentAuthTargetStatesKey(sandboxProfileId: string | null) {
  return [...sandboxProfileKey(sandboxProfileId), "target-states"] as const;
}

export function sandboxProfileTargetStateKey(sandboxProfileId: string | null) {
  return [...sandboxProfileKey(sandboxProfileId), "target-state"] as const;
}

export function sandboxProfileRuntimeConfigKey(sandboxProfileId: string | null) {
  return [...sandboxProfileKey(sandboxProfileId), "runtime-config"] as const;
}

export function agentAuthManagedCreditsKey(organizationId: string | null) {
  return [...agentAuthRootKey(), "managed-credits", organizationId] as const;
}

export type CloudOwnerScope = "personal" | "organization";

export interface CloudOwnerSelectionKey {
  ownerScope: CloudOwnerScope;
  organizationId: string | null;
}

export function personalCloudOwnerKey(): CloudOwnerSelectionKey {
  return { ownerScope: "personal", organizationId: null };
}

export function cloudBillingKey(
  owner: CloudOwnerSelectionKey = personalCloudOwnerKey(),
) {
  return [...cloudRootKey(), "billing", owner.ownerScope, owner.organizationId] as const;
}

export function cloudRepoBranchesKey(gitOwner: string, gitRepoName: string) {
  return [...cloudRootKey(), "repos", gitOwner, gitRepoName, "branches"] as const;
}

export function cloudGitRepositoriesRootKey() {
  return [...cloudRootKey(), "git-repositories"] as const;
}

export interface CloudGitRepositoriesKeyOptions {
  query?: string | null;
  cursor?: string | null;
  limit?: number | null;
  affiliation?: string | null;
  visibility?: string | null;
}

export function cloudGitRepositoriesKey(
  options: CloudGitRepositoriesKeyOptions = {},
) {
  return [
    ...cloudGitRepositoriesRootKey(),
    options.query?.trim() || null,
    options.cursor ?? null,
    options.limit ?? null,
    options.affiliation ?? null,
    options.visibility ?? null,
  ] as const;
}

export function cloudRepoConfigsKey() {
  return [...cloudRootKey(), "repo-configs"] as const;
}

export function cloudSecretsRootKey() {
  return [...cloudRootKey(), "secrets"] as const;
}

export function personalCloudSecretsKey() {
  return [...cloudSecretsRootKey(), "personal"] as const;
}

export function organizationCloudSecretsKey(organizationId: string | null) {
  return [...cloudSecretsRootKey(), "organizations", organizationId] as const;
}

export function workspaceCloudSecretsKey(gitOwner: string, gitRepoName: string) {
  return [...cloudSecretsRootKey(), "repos", gitOwner, gitRepoName] as const;
}

export function managedSandboxKey() {
  return [...cloudRootKey(), "managed-sandbox"] as const;
}

export function githubAppStatusRootKey(apiBaseUrl: string) {
  return [...cloudRootKey(), "github-app", "status", apiBaseUrl] as const;
}

export function githubAppStatusKey(
  apiBaseUrl: string,
  authCacheScope = "default",
  gitOwner: string | null = null,
  gitRepoName: string | null = null,
) {
  return [...githubAppStatusRootKey(apiBaseUrl), authCacheScope, gitOwner, gitRepoName] as const;
}

export function organizationCloudRepoConfigsKey(organizationId: string | null) {
  return [...cloudRootKey(), "organizations", organizationId, "repo-configs"] as const;
}

export function cloudWorktreeRetentionPolicyKey(userId: string | null) {
  return [...cloudRootKey(), "worktree-retention-policy", userId] as const;
}

export function cloudMobilityRootKey() {
  return [...cloudRootKey(), "mobility"] as const;
}

export function cloudMobilityWorkspacesKey() {
  return [...cloudMobilityRootKey(), "workspaces"] as const;
}

export function cloudMobilityWorkspaceKey(mobilityWorkspaceId: string) {
  return [...cloudMobilityWorkspacesKey(), mobilityWorkspaceId] as const;
}

export function cloudRepoConfigKey(gitOwner: string, gitRepoName: string) {
  return [...cloudRepoConfigsKey(), gitOwner, gitRepoName] as const;
}

export function organizationCloudRepoConfigKey(
  organizationId: string | null,
  gitOwner: string,
  gitRepoName: string,
) {
  return [...organizationCloudRepoConfigsKey(organizationId), gitOwner, gitRepoName] as const;
}

export function cloudWorkspaceConnectionKey(
  workspaceId: string,
  owner: CloudOwnerSelectionKey = personalCloudOwnerKey(),
) {
  return [
    ...cloudRootKey(),
    "workspaces",
    workspaceId,
    "connection",
    owner.ownerScope,
    owner.organizationId,
  ] as const;
}

export function cloudWorkspacesListRootKey() {
  return [...cloudRootKey(), "workspaces", "list"] as const;
}

export function cloudWorkspacesKey(
  owner: CloudOwnerSelectionKey = personalCloudOwnerKey(),
  scope: string | null = null,
  lifecycle: string | null = null,
) {
  return [
    ...cloudWorkspacesListRootKey(),
    owner.ownerScope,
    owner.organizationId,
    scope,
    lifecycle,
  ] as const;
}

export function isCloudWorkspaceConnectionQueryKey(
  queryKey: readonly unknown[],
): boolean {
  return queryKey[0] === "cloud"
    && queryKey[1] === "workspaces"
    && typeof queryKey[2] === "string"
    && queryKey[3] === "connection";
}

export function automationsRootKey() {
  return ["automations"] as const;
}

export interface AutomationsListKeyOptions {
  ownerScope?: CloudOwnerScope | null;
  organizationId?: string | null;
}

export function automationsListKey(options: AutomationsListKeyOptions = {}) {
  return [
    ...automationsRootKey(),
    "list",
    options.ownerScope ?? "personal",
    options.organizationId ?? null,
  ] as const;
}

export function automationDetailKey(automationId: string | null) {
  return [...automationsRootKey(), "detail", automationId] as const;
}

export function automationRunsKey(automationId: string | null) {
  return [...automationsRootKey(), "runs", automationId] as const;
}

export function agentRunConfigsRootKey() {
  return [...cloudRootKey(), "agent-run-configs"] as const;
}

export interface AgentRunConfigsListKeyOptions {
  ownerScope?: CloudOwnerScope | "system" | null;
  organizationId?: string | null;
  agentKind?: string | null;
  usableIn?: "personal_sandboxes" | "shared_sandboxes" | null;
  status?: "active" | "archived" | null;
}

export function agentRunConfigsListKey(
  options: AgentRunConfigsListKeyOptions = {},
) {
  return [
    ...agentRunConfigsRootKey(),
    "list",
    options.ownerScope ?? null,
    options.organizationId ?? null,
    options.agentKind ?? null,
    options.usableIn ?? null,
    options.status ?? null,
  ] as const;
}

export function agentRunConfigKey(configId: string | null) {
  return [...agentRunConfigsRootKey(), "detail", configId] as const;
}

export interface AgentRunConfigDefaultsKeyOptions {
  ownerScope?: CloudOwnerScope | null;
  organizationId?: string | null;
}

export function agentRunConfigDefaultsKey(
  options: AgentRunConfigDefaultsKeyOptions = {},
) {
  return [
    ...agentRunConfigsRootKey(),
    "defaults",
    options.ownerScope ?? "personal",
    options.organizationId ?? null,
  ] as const;
}

export function organizationsRootKey() {
  return ["organizations"] as const;
}

export function organizationsListKey() {
  return [...organizationsRootKey(), "list"] as const;
}

export function currentTeamKey() {
  return [...organizationsRootKey(), "current"] as const;
}

export function organizationMembersKey(organizationId: string | null) {
  return [...organizationsRootKey(), organizationId, "members"] as const;
}

export function organizationInvitationsKey(organizationId: string | null) {
  return [...organizationsRootKey(), organizationId, "invitations"] as const;
}

export function organizationJoinLinkKey(organizationId: string | null) {
  return [...organizationsRootKey(), organizationId, "join-link"] as const;
}

export function currentUserOrganizationInvitationsKey() {
  return [...organizationsRootKey(), "current-user", "invitations"] as const;
}

export function currentTeamCheckoutKey() {
  return [...cloudRootKey(), "billing", "team-checkout", "current"] as const;
}

export function cloudTargetsKey() {
  return [...cloudRootKey(), "targets"] as const;
}

export function cloudTargetKey(targetId: string | null) {
  return [...cloudTargetsKey(), targetId] as const;
}

export function cloudCommandKey(commandId: string | null) {
  return [...cloudRootKey(), "commands", commandId] as const;
}

export function cloudWorkspaceSnapshotKey(workspaceId: string | null) {
  return [...cloudRootKey(), "workspace-snapshots", workspaceId] as const;
}

export function cloudSessionSnapshotKey(targetId: string | null, sessionId: string | null) {
  return [...cloudRootKey(), "session-snapshots", targetId, sessionId] as const;
}

export function cloudTranscriptSnapshotKey(targetId: string | null, sessionId: string | null) {
  return [...cloudRootKey(), "transcript-snapshots", targetId, sessionId] as const;
}
