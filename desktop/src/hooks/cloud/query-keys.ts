export function cloudRootKey() {
  return ["cloud"] as const;
}

export function controlPlaneHealthKey(apiBaseUrl: string) {
  return [...cloudRootKey(), "control-plane-health", apiBaseUrl] as const;
}

export function cloudCredentialsKey() {
  return [...cloudRootKey(), "credentials"] as const;
}

export function cloudBillingKey() {
  return [...cloudRootKey(), "billing"] as const;
}

export function cloudRepoBranchesKey(gitOwner: string, gitRepoName: string) {
  return [...cloudRootKey(), "repos", gitOwner, gitRepoName, "branches"] as const;
}

export function cloudRepoConfigsKey() {
  return [...cloudRootKey(), "repo-configs"] as const;
}

export function cloudRepoConfigKey(gitOwner: string, gitRepoName: string) {
  return [...cloudRepoConfigsKey(), gitOwner, gitRepoName] as const;
}

export function cloudWorkspaceRepoConfigStatusKey(workspaceId: string) {
  return [...cloudRootKey(), "workspaces", workspaceId, "repo-config-status"] as const;
}

export function cloudWorkspaceConnectionKey(workspaceId: string) {
  return [...cloudRootKey(), "workspaces", workspaceId, "connection"] as const;
}

export function isCloudWorkspaceRepoConfigStatusQueryKey(
  queryKey: readonly unknown[],
): boolean {
  return queryKey[0] === "cloud"
    && queryKey[1] === "workspaces"
    && typeof queryKey[2] === "string"
    && queryKey[3] === "repo-config-status";
}
