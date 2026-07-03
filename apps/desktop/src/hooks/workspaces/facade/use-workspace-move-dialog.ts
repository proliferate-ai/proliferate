import { useMemo } from "react";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useWorkspaceMoveStore } from "@/stores/workspaces/workspace-move-store";

/**
 * Groups the move-dialog's open/workspaceId state (owned by the dedicated
 * `workspace-move-store`, since the dialog is opened from two independent entry points
 * -- the sidebar context menu and the workspace header location chip -- that don't
 * share a common parent) with the `Workspace`/`RepoRoot` lookup `MoveWorkspaceDialog`
 * needs, so callers don't have to resolve the target workspace themselves.
 */
export function useWorkspaceMoveDialog() {
  const open = useWorkspaceMoveStore((state) => state.dialogOpen);
  const workspaceId = useWorkspaceMoveStore((state) => state.dialogWorkspaceId);
  const onClose = useWorkspaceMoveStore((state) => state.closeMoveDialog);
  const { data: collections } = useWorkspaces({ enabled: open });

  const workspace = useMemo(
    () => (workspaceId ? collections?.workspaces.find((entry) => entry.id === workspaceId) : undefined),
    [collections?.workspaces, workspaceId],
  );
  const repoRoot = useMemo(
    () => (workspace?.repoRootId
      ? collections?.repoRoots.find((entry) => entry.id === workspace.repoRootId)
      : undefined),
    [collections?.repoRoots, workspace?.repoRootId],
  );

  return {
    open,
    workspaceId,
    workspaceKind: workspace?.kind ?? null,
    repoRoot: repoRoot ?? null,
    onClose,
  };
}
