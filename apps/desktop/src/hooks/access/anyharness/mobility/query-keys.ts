export function workspaceMobilityPreflightKey(runtimeUrl: string, workspaceId: string) {
  return ["anyharness", "mobility", "preflight", runtimeUrl, workspaceId] as const;
}
