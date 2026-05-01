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
