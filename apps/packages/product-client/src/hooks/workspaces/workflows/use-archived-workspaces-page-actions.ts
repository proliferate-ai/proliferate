import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "@proliferate/design/motion";
import { useArchivedWorkspaces } from "#product/hooks/workspaces/cache/use-archived-workspaces";
import { useArchivedWorkspacesInvalidation } from "#product/hooks/workspaces/cache/use-archived-workspaces-invalidation";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useWorkspaceCollectionsInvalidation } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspacePurgeActions } from "#product/hooks/workspaces/workflows/use-workspace-purge-actions";
import { useWorkspaceArchiveActionsContext } from "#product/providers/WorkspaceArchiveActionsProvider";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import {
  ARCHIVED_WORKSPACE_SORT_OPTIONS,
  filterAndSortArchivedWorkspaces,
  type ArchivedWorkspaceSort,
} from "#product/lib/domain/workspaces/archived/archived-workspace-presentation";
import { workspaceDisplayName } from "#product/lib/domain/workspaces/display/workspace-display";
import type { UnarchiveScenarioAnswer } from "#product/lib/domain/workspaces/archived/archive-knob-resolution";

// A row's disclosure collapse is started on click; the actual server call
// (unarchive or delete) waits it out so the animation never gets starved by
// the immediate list re-render a fast response would otherwise cause.
const ROW_EXIT_DELAY_MS = motion.duration.disclosureMs;
// A row that neither succeeds nor raises the 409 scenario dialog within this
// window reinstates rather than staying collapsed forever on a silent stall.
// Shares `optimisticSettleTimeoutMs` with the archive settle above: both are
// the same "definite outcome or genuinely unknown" bound, previously tuned
// independently to 10s/12s for no principled reason.
const UNARCHIVE_SETTLE_TIMEOUT_MS = motion.delay.optimisticSettleTimeoutMs;

export type ArchivedDeleteTarget = string | "all" | null;

export function useArchivedWorkspacesPageActions() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { data: archivedWorkspaces = [], isLoading } = useArchivedWorkspaces();
  const { data: collections } = useWorkspaces();
  const repoRoots = collections?.repoRoots ?? [];
  const invalidateActiveCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const invalidateArchived = useArchivedWorkspacesInvalidation(runtimeUrl);
  const { markDone: purgeWorkspace } = useWorkspacePurgeActions();
  const {
    unarchive,
    scenario,
    dismissScenario,
  } = useWorkspaceArchiveActionsContext();
  const showError = useToastStore((state) => state.showError);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ArchivedWorkspaceSort>("archived");
  const [exitingIds, setExitingIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ArchivedDeleteTarget>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const exitTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => () => {
    for (const timer of exitTimersRef.current.values()) {
      clearTimeout(timer);
    }
    exitTimersRef.current.clear();
  }, []);

  const addExiting = useCallback((workspaceId: string) => {
    setExitingIds((current) => {
      const next = new Set(current);
      next.add(workspaceId);
      return next;
    });
  }, []);

  const removeExiting = useCallback((workspaceId: string) => {
    const timer = exitTimersRef.current.get(workspaceId);
    if (timer !== undefined) {
      clearTimeout(timer);
      exitTimersRef.current.delete(workspaceId);
    }
    setExitingIds((current) => {
      if (!current.has(workspaceId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(workspaceId);
      return next;
    });
  }, []);

  // The 409 scenario answers this id's unarchive right now — reinstate the
  // row immediately rather than waiting out the settle timeout, since the
  // dialog (not the collapsed row) is the surface the user needs.
  useEffect(() => {
    if (scenario) {
      removeExiting(scenario.workspaceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- removeExiting is stable
  }, [scenario]);

  const requestUnarchive = useCallback((workspaceId: string) => {
    const workspace = archivedWorkspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      return;
    }
    addExiting(workspaceId);
    const timer = setTimeout(() => {
      unarchive(workspaceId, workspaceDisplayName(workspace));
      exitTimersRef.current.set(
        workspaceId,
        setTimeout(() => removeExiting(workspaceId), UNARCHIVE_SETTLE_TIMEOUT_MS),
      );
    }, ROW_EXIT_DELAY_MS);
    exitTimersRef.current.set(workspaceId, timer);
  }, [addExiting, archivedWorkspaces, removeExiting, unarchive]);

  const onScenarioConfirm = useCallback((workspaceId: string, answer: UnarchiveScenarioAnswer) => {
    const workspace = archivedWorkspaces.find((candidate) => candidate.id === workspaceId);
    unarchive(workspaceId, workspace ? workspaceDisplayName(workspace) : "workspace", answer);
    addExiting(workspaceId);
  }, [addExiting, archivedWorkspaces, unarchive]);

  const requestDelete = useCallback((workspaceId: string) => {
    setDeleteTarget(workspaceId);
  }, []);

  const requestDeleteAll = useCallback(() => {
    setDeleteTarget("all");
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) {
      return;
    }
    const targetIds = target === "all"
      ? archivedWorkspaces.map((workspace) => workspace.id)
      : [target];
    setIsDeleting(true);
    setDeleteTarget(null);
    for (const id of targetIds) {
      addExiting(id);
    }
    try {
      await Promise.all(targetIds.map((id) => purgeWorkspace(id)));
    } catch (error) {
      showError({
        headline: target === "all" ? "Couldn't delete all archived workspaces" : "Couldn't delete workspace",
        consequence: "Nothing was removed. Try again.",
        cause: error instanceof Error ? error.message : String(error),
      });
      for (const id of targetIds) {
        removeExiting(id);
      }
      setIsDeleting(false);
      return;
    }
    await invalidateArchived();
    void invalidateActiveCollections();
    for (const id of targetIds) {
      removeExiting(id);
    }
    setIsDeleting(false);
  }, [
    addExiting,
    archivedWorkspaces,
    deleteTarget,
    invalidateActiveCollections,
    invalidateArchived,
    purgeWorkspace,
    removeExiting,
    showError,
  ]);

  const visibleWorkspaces = useMemo(
    () => filterAndSortArchivedWorkspaces(archivedWorkspaces, repoRoots, search, sort),
    [archivedWorkspaces, repoRoots, search, sort],
  );

  const deleteTargetWorkspace = typeof deleteTarget === "string" && deleteTarget !== "all"
    ? archivedWorkspaces.find((workspace) => workspace.id === deleteTarget) ?? null
    : null;

  return {
    isLoading,
    workspaces: visibleWorkspaces,
    repoRoots,
    hasAnyArchived: archivedWorkspaces.length > 0,
    hasSearchMatches: visibleWorkspaces.length > 0,
    search,
    setSearch,
    sort,
    setSort,
    sortOptions: ARCHIVED_WORKSPACE_SORT_OPTIONS,
    exitingIds,
    requestUnarchive,
    requestDelete,
    requestDeleteAll,
    cancelDelete,
    confirmDelete,
    deleteTarget,
    deleteTargetWorkspace,
    deleteAllCount: archivedWorkspaces.length,
    isDeleting,
    scenario,
    dismissScenario,
    onScenarioConfirm,
  };
}
