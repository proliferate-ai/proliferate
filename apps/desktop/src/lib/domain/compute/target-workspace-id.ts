const TARGET_WORKSPACE_PREFIX = "target";

export interface TargetWorkspaceSyntheticId {
  targetId: string;
  anyharnessWorkspaceId: string;
}

export function targetWorkspaceSyntheticId(
  targetId: string,
  anyharnessWorkspaceId: string,
): string {
  return `${TARGET_WORKSPACE_PREFIX}:${targetId}:${anyharnessWorkspaceId}`;
}

export function parseTargetWorkspaceSyntheticId(
  workspaceId: string,
): TargetWorkspaceSyntheticId | null {
  const [prefix, targetId, anyharnessWorkspaceId, ...extra] = workspaceId.split(":");
  if (
    prefix !== TARGET_WORKSPACE_PREFIX
    || !targetId
    || !anyharnessWorkspaceId
    || extra.length > 0
  ) {
    return null;
  }
  return { targetId, anyharnessWorkspaceId };
}
