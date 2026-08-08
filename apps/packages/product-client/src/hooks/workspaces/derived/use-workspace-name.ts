import { useCallback } from "react";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";

/**
 * Resolve a workspace id to the name the human already sees in the sidebar.
 *
 * Agent-ops receipts carry only a workspace id ("an agent spawned elsewhere
 * carries — in <workspace name>", ADR §4). The workspace collection is already
 * cached client-side, so the receipt reads a name rather than an opaque id;
 * when the id is not in the cache the receipt stays silent about it rather than
 * printing the id at the human.
 */
export function useWorkspaceNameResolver(): (workspaceId: string | null | undefined) => string | null {
  const { logicalWorkspaces } = useLogicalWorkspaces();
  return useCallback(
    (workspaceId) => resolveWorkspaceName(logicalWorkspaces, workspaceId),
    [logicalWorkspaces],
  );
}

export function resolveWorkspaceName(
  workspaces: readonly LogicalWorkspace[],
  workspaceId: string | null | undefined,
): string | null {
  const target = workspaceId?.trim();
  if (!target) {
    return null;
  }
  const match = workspaces.find((workspace) =>
    workspace.id === target
    || workspace.preferredMaterializationId === target
    || workspace.localWorkspace?.id === target
    || workspace.aliasIds?.includes(target)
  );
  const name = match?.displayName.trim();
  return name && name.length > 0 ? name : null;
}
