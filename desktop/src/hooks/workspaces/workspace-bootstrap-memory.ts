const bootstrappedWorkspaceIds = new Set<string>();

export function hasWorkspaceBootstrappedInSession(workspaceId: string): boolean {
  return bootstrappedWorkspaceIds.has(workspaceId);
}

export function markWorkspaceBootstrappedInSession(workspaceId: string): void {
  bootstrappedWorkspaceIds.add(workspaceId);
}

export function clearWorkspaceBootstrappedInSession(workspaceId: string): void {
  bootstrappedWorkspaceIds.delete(workspaceId);
}
