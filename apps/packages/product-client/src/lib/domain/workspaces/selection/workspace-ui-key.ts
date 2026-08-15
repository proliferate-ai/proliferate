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

/**
 * The ui key a failed session creation should recover under.
 *
 * An unattended launch materializes its session while the user is looking at
 * another workspace, so recovery cannot derive the key from the current
 * selection (that would name the wrong workspace); the caller names it instead.
 * Shell intent is deliberately not keyed from this: the writer's own resolution
 * already yields this same id while the workspace is unselected, and yields the
 * logical id once it is selected, which is the key later reads use (PRO-230).
 */
export function resolveRecoveryWorkspaceUiKey(
  targetWorkspaceUiKey: string | null | undefined,
  selectedLogicalWorkspaceId: string | null | undefined,
  workspaceId: string,
): string {
  return targetWorkspaceUiKey
    ?? resolveWorkspaceUiKey(selectedLogicalWorkspaceId, workspaceId)
    ?? workspaceId;
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
