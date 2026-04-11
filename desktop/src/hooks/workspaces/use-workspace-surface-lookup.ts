import type { Workspace } from "@anyharness/sdk";
import { useCallback, useMemo } from "react";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useWorkspaceSurfaceLookup() {
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;

  const surfaceByWorkspaceId = useMemo(() => new Map(
    workspaces.map((workspace) => [workspace.id, workspace.surface]),
  ), [workspaces]);

  const getWorkspaceSurface = useCallback((workspaceId: string | null | undefined) => {
    if (!workspaceId) {
      return null;
    }

    return surfaceByWorkspaceId.get(workspaceId) ?? null;
  }, [surfaceByWorkspaceId]);

  return {
    getWorkspaceSurface,
  };
}
