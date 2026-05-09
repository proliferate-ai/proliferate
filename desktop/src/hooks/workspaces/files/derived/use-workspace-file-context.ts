import { useMemo, useRef } from "react";
import type { Workspace } from "@anyharness/sdk";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { workspaceFileTreeStateKey } from "@/lib/domain/workspaces/cloud/collections";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const EMPTY_WORKSPACES: Workspace[] = [];

export interface WorkspaceFileContext {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
  treeStateKey: string | null;
}

export function useWorkspaceFileContext(): WorkspaceFileContext {
  const stableTreeStateKeyRef = useRef<{
    materializedWorkspaceId: string;
    treeStateKey: string;
  } | null>(null);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const workspaceCollections = useWorkspaces().data;
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const { workspaceUiKey, materializedWorkspaceId } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });

  const candidateTreeStateKey = useMemo(() => {
    if (!materializedWorkspaceId) {
      return null;
    }
    const workspace = workspaces.find((entry) => entry.id === materializedWorkspaceId);
    return workspace ? workspaceFileTreeStateKey(workspace) : materializedWorkspaceId;
  }, [materializedWorkspaceId, workspaces]);

  // Keep the tree UI store key fixed for the current workspace. When
  // collections finish loading, switching keys would orphan expanded state.
  if (!materializedWorkspaceId || !candidateTreeStateKey) {
    stableTreeStateKeyRef.current = null;
  } else if (stableTreeStateKeyRef.current?.materializedWorkspaceId !== materializedWorkspaceId) {
    stableTreeStateKeyRef.current = {
      materializedWorkspaceId,
      treeStateKey: candidateTreeStateKey,
    };
  }

  return {
    workspaceUiKey,
    materializedWorkspaceId,
    treeStateKey: stableTreeStateKeyRef.current?.treeStateKey ?? null,
  };
}
