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

export function cloudAgentCatalogKey() {
  return [...cloudRootKey(), "agent-catalog", "v1"] as const;
}

export function agentGatewayRootKey() {
  return [...cloudRootKey(), "agent-gateway"] as const;
}

export function agentApiKeysKey() {
  return [...agentGatewayRootKey(), "keys"] as const;
}

export function agentSeatUsageKey() {
  return [...agentGatewayRootKey(), "seat-usage"] as const;
}

export function agentAuthSelectionsRootKey() {
  return [...agentGatewayRootKey(), "selections"] as const;
}

export function agentAuthSelectionsKey(surface: string | null = null) {
  return [...agentAuthSelectionsRootKey(), surface ?? "all"] as const;
}

export function agentAuthStateRootKey() {
  return [...agentGatewayRootKey(), "state"] as const;
}

export function agentAuthStateKey(surface: string) {
  return [...agentAuthStateRootKey(), surface] as const;
}

// Under the state root ON PURPOSE: every invalidation that re-pulls the state
// document (selection PUT, vault create/revoke, seat mint, enrollment sync)
// re-reads the settings rider on the same chain.
export function agentAuthHarnessSettingsKey(surface: string) {
  return [...agentAuthStateRootKey(), surface, "harness-settings"] as const;
}

export function agentGatewayCapabilitiesKey() {
  return [...agentGatewayRootKey(), "capabilities"] as const;
}

export function agentGatewayEnrollmentKey() {
  return [...agentGatewayRootKey(), "enrollment"] as const;
}

// The composed re-key (model-catalog.md §Cloud routes): the cloud snapshot is
// keyed by harness alone — one composed observation per harness; the former
// per-authContextId key segment is deleted.
export function agentModelsRootKey() {
  return [...agentGatewayRootKey(), "agent-models"] as const;
}

export function agentModelsKey(harnessKind: string) {
  return [...agentModelsRootKey(), harnessKind] as const;
}

export function orgAgentPolicyKey(organizationId: string) {
  return [...agentGatewayRootKey(), "org-policy", organizationId] as const;
}

export function orgAgentPolicyViolationsKey(organizationId: string) {
  return [
    ...agentGatewayRootKey(),
    "org-policy",
    organizationId,
    "violations",
  ] as const;
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

export function cloudIntegrationsRootKey() {
  return [...cloudRootKey(), "integrations"] as const;
}

export function cloudIntegrationsCatalogKey(organizationId: string | null = null) {
  return [...cloudIntegrationsRootKey(), "catalog", organizationId] as const;
}

export function cloudIntegrationsHealthKey(organizationId: string | null = null) {
  return [...cloudIntegrationsRootKey(), "health", organizationId] as const;
}

export function cloudIntegrationOauthFlowKey(flowId: string | null) {
  return [...cloudIntegrationsRootKey(), "oauth-flow", flowId] as const;
}

export function cloudIntegrationAdminDefinitionsKey(organizationId: string | null) {
  return [...cloudIntegrationsRootKey(), "admin-definitions", organizationId] as const;
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

export function usageRootKey(
  owner: CloudOwnerSelectionKey = personalCloudOwnerKey(),
) {
  return [...cloudRootKey(), "usage", owner.ownerScope, owner.organizationId] as const;
}

export function usageSummaryKey(
  owner: CloudOwnerSelectionKey = personalCloudOwnerKey(),
) {
  return [...usageRootKey(owner), "summary"] as const;
}

export interface UsageTimeseriesKeyOptions {
  granularity?: string | null;
  days?: number | null;
  kind?: string | null;
}

export function usageTimeseriesKey(
  owner: CloudOwnerSelectionKey = personalCloudOwnerKey(),
  options: UsageTimeseriesKeyOptions = {},
) {
  return [
    ...usageRootKey(owner),
    "timeseries",
    options.granularity ?? "day",
    options.days ?? 30,
    options.kind ?? "all",
  ] as const;
}

export function llmBalanceKey(
  owner: CloudOwnerSelectionKey = personalCloudOwnerKey(),
) {
  return [...usageRootKey(owner), "llm-balance"] as const;
}

export function orgUsageByUserRootKey(organizationId: string | null) {
  return [...organizationsRootKey(), organizationId, "usage", "by-user"] as const;
}

export function orgUsageByUserKey(organizationId: string | null, days: number | null = null) {
  return [...orgUsageByUserRootKey(organizationId), days ?? 30] as const;
}

export function orgUserUsageTimeseriesKey(
  organizationId: string | null,
  userId: string | null,
  options: UsageTimeseriesKeyOptions = {},
) {
  return [
    ...organizationsRootKey(),
    organizationId,
    "usage",
    "users",
    userId,
    "timeseries",
    options.granularity ?? "day",
    options.days ?? 30,
    options.kind ?? "all",
  ] as const;
}

export function orgLimitsKey(organizationId: string | null) {
  return [...organizationsRootKey(), organizationId, "limits"] as const;
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

export function repositoriesKey() {
  return [...cloudRootKey(), "repositories"] as const;
}

export function actorRepositoriesKey(apiBaseUrl: string, authCacheScope: string) {
  return [
    ...repositoriesKey(),
    "actor",
    apiBaseUrl,
    authCacheScope,
  ] as const;
}

export function repoEnvironmentKey(
  gitOwner: string,
  gitRepoName: string,
  environmentKind: "local" | "cloud",
  desktopInstallId: string | null = null,
  localPath: string | null = null,
) {
  return [
    ...repositoriesKey(),
    gitOwner,
    gitRepoName,
    "environments",
    environmentKind,
    desktopInstallId,
    localPath,
  ] as const;
}

export function githubAppRootKey(apiBaseUrl: string) {
  return [...cloudRootKey(), "github-app", apiBaseUrl] as const;
}

export function githubAppAccessibleReposKey(
  apiBaseUrl: string,
  options: CloudGitRepositoriesKeyOptions = {},
) {
  return [
    ...githubAppRootKey(apiBaseUrl),
    "accessible-repos",
    options.query?.trim() || null,
    options.cursor ?? null,
    options.limit ?? null,
    options.affiliation ?? null,
    options.visibility ?? null,
  ] as const;
}

export function githubAppUserAuthorizationKey(
  apiBaseUrl: string,
  authCacheScope = "default",
) {
  return [...githubAppRootKey(apiBaseUrl), "user-authorization", authCacheScope] as const;
}

export function githubAppInstallationKey(
  apiBaseUrl: string,
  organizationId: string | null,
) {
  return [...githubAppRootKey(apiBaseUrl), "installation", organizationId] as const;
}

export function githubRepoAuthorityKey(
  apiBaseUrl: string,
  gitOwner: string,
  gitRepoName: string,
) {
  return [...githubAppRootKey(apiBaseUrl), "repo-authority", gitOwner, gitRepoName] as const;
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
