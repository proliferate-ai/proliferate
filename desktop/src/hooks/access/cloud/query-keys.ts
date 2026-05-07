export function cloudRootKey() {
  return ["cloud"] as const;
}

export function controlPlaneHealthKey(apiBaseUrl: string) {
  return [...cloudRootKey(), "control-plane-health", apiBaseUrl] as const;
}

export function cloudCredentialsKey() {
  return [...cloudRootKey(), "credentials"] as const;
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
