export interface SelectedWorkspaceIdentity {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
  sdkWorkspaceId: string | null;
}

export function resolveWorkspaceUiKey(
  selectedLogicalWorkspaceId: string | null | undefined,
  materializedWorkspaceId: string | null | undefined,
): string | null {
  return selectedLogicalWorkspaceId ?? materializedWorkspaceId ?? null;
}

export function resolveWorkspaceShellStateKey(args: {
  workspaceId: string | null | undefined;
  shellWorkspaceId?: string | null | undefined;
  selectedWorkspaceId?: string | null | undefined;
  selectedLogicalWorkspaceId?: string | null | undefined;
}): string | null {
  const workspaceId = args.workspaceId ?? null;
  if (!workspaceId) {
    return null;
  }
  if (args.shellWorkspaceId) {
    return args.shellWorkspaceId;
  }
  if (args.selectedWorkspaceId === workspaceId) {
    return resolveWorkspaceUiKey(args.selectedLogicalWorkspaceId, workspaceId);
  }
  return workspaceId;
}

export function resolveSelectedWorkspaceIdentity(args: {
  selectedLogicalWorkspaceId: string | null | undefined;
  materializedWorkspaceId: string | null | undefined;
}): SelectedWorkspaceIdentity {
  const materializedWorkspaceId = args.materializedWorkspaceId ?? null;
  return {
    workspaceUiKey: resolveWorkspaceUiKey(
      args.selectedLogicalWorkspaceId,
      materializedWorkspaceId,
    ),
    materializedWorkspaceId,
    sdkWorkspaceId: materializedWorkspaceId,
  };
}
