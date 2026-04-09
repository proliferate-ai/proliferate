export function cloudWorkspaceSyntheticId(cloudWorkspaceId: string): string {
  return `cloud:${cloudWorkspaceId}`;
}

export function parseCloudWorkspaceSyntheticId(
  workspaceId: string | null | undefined,
): string | null {
  if (!workspaceId?.startsWith("cloud:")) {
    return null;
  }

  return workspaceId.slice("cloud:".length) || null;
}

export function isCloudWorkspaceId(
  workspaceId: string | null | undefined,
): boolean {
  return parseCloudWorkspaceSyntheticId(workspaceId) !== null;
}
