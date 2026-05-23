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

export function agentAuthCredentialsKey(
  organizationId: string | null = null,
  agentKind: string | null = null,
) {
  return [...agentAuthRootKey(), "credentials", organizationId, agentKind] as const;
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

export function cloudRepoConfigsKey() {
  return [...cloudRootKey(), "repo-configs"] as const;
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

export function cloudWorkspaceRepoConfigStatusKey(
  workspaceId: string,
  owner: CloudOwnerSelectionKey = personalCloudOwnerKey(),
) {
  return [
    ...cloudRootKey(),
    "workspaces",
    workspaceId,
    "repo-config-status",
    owner.ownerScope,
    owner.organizationId,
  ] as const;
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

export function cloudWorkspacesKey(
  owner: CloudOwnerSelectionKey = personalCloudOwnerKey(),
  scope: string | null = null,
) {
  return [
    ...cloudRootKey(),
    "workspaces",
    "list",
    owner.ownerScope,
    owner.organizationId,
    scope,
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

export function isCloudWorkspaceRepoConfigStatusQueryKey(
  queryKey: readonly unknown[],
): boolean {
  return queryKey[0] === "cloud"
    && queryKey[1] === "workspaces"
    && typeof queryKey[2] === "string"
    && queryKey[3] === "repo-config-status";
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

export function organizationsRootKey() {
  return ["organizations"] as const;
}

export function organizationsListKey() {
  return [...organizationsRootKey(), "list"] as const;
}

export function organizationMembersKey(organizationId: string | null) {
  return [...organizationsRootKey(), organizationId, "members"] as const;
}

export function organizationInvitationsKey(organizationId: string | null) {
  return [...organizationsRootKey(), organizationId, "invitations"] as const;
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
