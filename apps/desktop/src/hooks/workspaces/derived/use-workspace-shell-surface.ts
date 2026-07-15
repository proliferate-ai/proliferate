import { useMemo } from "react";
import {
  resolveWorkspaceShellSurface,
  type WorkspaceShellSurface,
} from "@/lib/domain/workspaces/shell/shell-surface";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

// Which shell the selected workspace renders in ("cowork" covers pending
// cowork-created entries whose workspace does not exist yet). Mirrors the
// resolution MainScreen uses to pick the shell component, so composer-level
// surface policy stays in lockstep with the shell actually on screen.
export function useWorkspaceShellSurface(): WorkspaceShellSurface {
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();

  return useMemo(() => {
    const selectedWorkspace = workspaceCollections?.workspaces.find(
      (workspace) => workspace.id === selectedWorkspaceId,
    ) ?? null;
    return resolveWorkspaceShellSurface(selectedWorkspace, pendingWorkspaceEntry);
  }, [pendingWorkspaceEntry, selectedWorkspaceId, workspaceCollections]);
}
