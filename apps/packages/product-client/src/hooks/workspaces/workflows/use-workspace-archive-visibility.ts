import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceArchiveVisibilityStore } from "#product/stores/workspaces/workspace-archive-visibility-store";

export function useWorkspaceArchiveVisibility(invalidateLists: () => Promise<unknown>) {
  const [pendingDecisionIds, setPendingDecisionIds] = useState<ReadonlySet<string>>(new Set());
  const optimisticallyArchivedIds = useWorkspaceArchiveVisibilityStore(
    (state) => state.optimisticallyArchivedIds,
  );
  const beginOwner = useWorkspaceArchiveVisibilityStore((state) => state.beginOwner);
  const endOwner = useWorkspaceArchiveVisibilityStore((state) => state.endOwner);
  const hideWorkspace = useWorkspaceArchiveVisibilityStore((state) => state.hideWorkspace);
  const showWorkspace = useWorkspaceArchiveVisibilityStore((state) => state.showWorkspace);
  const ownerGenerationRef = useRef<number | null>(null);

  const addOptimistic = useCallback((workspaceId: string) => {
    setPendingDecisionIds((current) => {
      const next = new Set(current);
      next.add(workspaceId);
      return next;
    });
    const generation = ownerGenerationRef.current;
    if (generation !== null) {
      hideWorkspace(generation, workspaceId);
    }
  }, [hideWorkspace]);

  const removePendingDecision = useCallback((workspaceId: string) => {
    setPendingDecisionIds((current) => {
      if (!current.has(workspaceId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(workspaceId);
      return next;
    });
  }, []);

  const removeOptimistic = useCallback((workspaceId: string) => {
    removePendingDecision(workspaceId);
    const generation = ownerGenerationRef.current;
    if (generation !== null) {
      showWorkspace(generation, workspaceId);
    }
  }, [removePendingDecision, showWorkspace]);

  useEffect(() => {
    const generation = beginOwner();
    ownerGenerationRef.current = generation;
    return () => {
      ownerGenerationRef.current = null;
      endOwner(generation);
    };
  }, [beginOwner, endOwner]);

  const releaseHiddenAfterListsSettle = useCallback((workspaceId: string) => {
    removePendingDecision(workspaceId);
    void invalidateLists().finally(() => {
      const generation = ownerGenerationRef.current;
      if (generation !== null) {
        showWorkspace(generation, workspaceId);
      }
    });
  }, [invalidateLists, removePendingDecision, showWorkspace]);

  return {
    addOptimistic,
    optimisticallyArchivedIds,
    pendingDecisionIds,
    releaseHiddenAfterListsSettle,
    removeOptimistic,
  };
}
