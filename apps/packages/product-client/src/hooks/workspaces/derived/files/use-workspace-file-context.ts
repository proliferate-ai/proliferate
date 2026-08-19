import { useMemo } from "react";
import type { Workspace } from "@anyharness/sdk";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { workspaceFileTreeStateKey } from "#product/lib/domain/workspaces/cloud/collections";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import {
  selectFileTreeStateKey,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const EMPTY_WORKSPACES: Workspace[] = [];

export interface WorkspaceFileContext {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
  treeStateKey: string | null;
}

/**
 * Pure/read-only derivation of the file owner's context.
 *
 * `workspaceUiKey` owns logical-workspace preferences, `materializedWorkspaceId`
 * owns runtime queries and cleanup, and `treeStateKey` is the stable
 * per-materialization key that participates in the session-only expansion scope.
 *
 * This hook owns no ref registry, effect, layout effect, store action, or
 * mutation. It derives the candidate key exactly as before and reads the
 * session-level first-key registry through `selectFileTreeStateKey`, whose
 * pre-claim fallback makes the first render usable. The sole dock controller
 * (`FileEditorView`) claims that candidate in its layout lifecycle, so the
 * chosen first key survives controller/hook unmount and later collection
 * enrichment; a second hook instance can only read the claimed value.
 */
export function useWorkspaceFileContext(): WorkspaceFileContext {
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

  const treeStateKey = useFileTreeStore((state) =>
    selectFileTreeStateKey(state, { materializedWorkspaceId, candidateTreeStateKey }));

  return { workspaceUiKey, materializedWorkspaceId, treeStateKey };
}
