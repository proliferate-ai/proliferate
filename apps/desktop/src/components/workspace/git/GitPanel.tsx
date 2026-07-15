import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevertGitPatchesMutation } from "@anyharness/sdk-react";
import { GitPanelHeader } from "./GitPanelHeader";
import { SkeletonBlock, shimmerDelay } from "@/components/feedback/Skeleton";
import { GitPanelReviewBody } from "./GitPanelReviewBody";
import { formatGitPanelUndoError } from "./GitPanelReviewChrome";
import { useWorkspaceShellActions } from "@/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { useDiffReviewMeasurement } from "@/hooks/workspaces/ui/files/use-diff-review-measurement";
import { useWorkspaceFileActions } from "@/hooks/workspaces/facade/files/use-workspace-file-actions";
import { useWorkspaceFileContext } from "@/hooks/workspaces/derived/files/use-workspace-file-context";
import { useGitPanelState } from "@/hooks/workspaces/derived/use-git-panel-state";
import { type GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";
import {
  resolveDiffDisplayPolicy,
  summarizeDiffDisplayPolicies,
} from "@/lib/domain/workspaces/changes/diff-display-policy";
import {
  buildGitReviewFileEntries,
  type GitReviewFileEntry,
} from "@/lib/domain/workspaces/changes/git-review-entries";
import {
  buildGitPanelDiffFetchScopeKey,
  countUniqueReviewPatchPaths,
  resolveLastTurnUndoDisabledReason,
  resolvePermittedGitPanelDiffFetchKeys,
  summarizeGitPanelSectionStats,
  toggleReviewSetValue,
} from "@/lib/domain/workspaces/changes/git-panel-review-model";
import { useGitPanelUiStore } from "@/stores/editor/git-panel-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_LAST_TURN_REVERT_PATCHES = {
  entries: [],
  blockedReason: null,
};

export function GitPanel() {
  const diffReviewMeasurement = useDiffReviewMeasurement();
  if (diffReviewMeasurement.deferQueryMount) {
    return (
      <div className="flex h-full min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
        <GitPanelLoadingSkeleton />
      </div>
    );
  }

  return <GitPanelContent diffReviewMeasurement={diffReviewMeasurement} />;
}

function GitPanelLoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-1.5 px-2 pt-2"
      role="status"
      aria-label="Loading changes"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="overflow-clip rounded-lg bg-[var(--color-diff-panel-surface)]"
        >
          <div className="flex min-h-9 items-center gap-2.5 bg-[var(--color-diff-sidebar-file-header-surface)] px-5 py-1.5">
            <SkeletonBlock
              className="h-3 w-40 bg-sidebar-accent"
              style={shimmerDelay(index)}
            />
            <SkeletonBlock
              className="ms-auto h-3 w-12 bg-sidebar-accent"
              style={shimmerDelay(index + 1)}
            />
          </div>
          <div className="space-y-2 px-5 py-3">
            <SkeletonBlock
              className="h-2.5 w-3/4 bg-sidebar-accent"
              style={shimmerDelay(index + 1)}
            />
            <SkeletonBlock
              className="h-2.5 w-1/2 bg-sidebar-accent"
              style={shimmerDelay(index + 2)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

type DiffReviewMeasurementState = ReturnType<typeof useDiffReviewMeasurement>;

function GitPanelContent({
  diffReviewMeasurement,
}: {
  diffReviewMeasurement: DiffReviewMeasurementState;
}) {
  const [changesFilter, setChangesFilter] = useState<GitPanelMode>("working_tree_composite");
  const [selectedBaseRef, setSelectedBaseRef] = useState<string | null>(null);
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [wrapLongLines, setWrapLongLines] = useState(false);
  // Files render expanded by default; this set only holds explicit collapses.
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [settledDiffFetchKeys, setSettledDiffFetchKeys] = useState<Set<string>>(new Set());
  const [undoneTurnIds, setUndoneTurnIds] = useState<ReadonlySet<string>>(() => new Set());
  const fileContext = useWorkspaceFileContext();
  const modeRequest = useGitPanelUiStore((state) =>
    fileContext.materializedWorkspaceId
      ? state.modeRequestsByWorkspace[fileContext.materializedWorkspaceId] ?? null
      : null
  );
  const { openFile } = useWorkspaceFileActions();
  const {
    activeWorkspaceId,
    baseRef,
    branchRefs = [],
    sections,
    visibleChangedCount,
    isRuntimeReady,
    runtimeBlockedReason,
    isLoading,
    errorMessage,
    lastTurn,
    lastTurnRevertPatches,
    refetch,
  } = useGitPanelState(changesFilter, {
    baseRefOverride: selectedBaseRef,
    statusTimingOptions: diffReviewMeasurement.statusTimingOptions,
    branchDiffFilesTimingOptions: diffReviewMeasurement.branchDiffFilesTimingOptions,
  });
  const revertPatchesMutation = useRevertGitPatchesMutation({ workspaceId: activeWorkspaceId });
  const showToast = useToastStore((state) => state.show);
  const shellActions = useWorkspaceShellActions();
  const currentBranch = useMemo(
    () => branchRefs.find((ref) => ref.isHead && !ref.isRemote)?.name ?? null,
    [branchRefs],
  );
  const effectiveLastTurnRevertPatches =
    lastTurnRevertPatches ?? EMPTY_LAST_TURN_REVERT_PATCHES;
  const lastTurnUndoCompleted = Boolean(lastTurn?.turnId && undoneTurnIds.has(lastTurn.turnId));
  const lastTurnPatchFileCount = useMemo(
    () => countUniqueReviewPatchPaths(effectiveLastTurnRevertPatches.entries),
    [effectiveLastTurnRevertPatches.entries],
  );
  const reviewEntries = useMemo(
    () => buildGitReviewFileEntries(sections),
    [sections],
  );
  const hasReviewEntries = reviewEntries.length > 0;
  const aggregateStats = useMemo(
    () => summarizeGitPanelSectionStats(sections),
    [sections],
  );
  const visibleSectionScopes = useMemo(
    () => new Set(sections.map((section) => section.scope)),
    [sections],
  );
  const diffPolicySummary = useMemo(
    () => summarizeDiffDisplayPolicies(
      reviewEntries.flatMap((entry) => {
        const currentDiff = entry.file.currentDiff;
        return currentDiff
          ? [resolveDiffDisplayPolicy({
              path: currentDiff.path,
              additions: currentDiff.additions,
              deletions: currentDiff.deletions,
            })]
          : [];
      }),
    ),
    [reviewEntries],
  );
  const diffFetchScopeKey = useMemo(
    () => buildGitPanelDiffFetchScopeKey({
      activeWorkspaceId,
      baseRef,
      mode: changesFilter,
      reviewEntries,
    }),
    [activeWorkspaceId, baseRef, changesFilter, reviewEntries],
  );
  useEffect(() => {
    setSettledDiffFetchKeys(new Set());
  }, [diffFetchScopeKey]);
  const permittedDiffFetchKeys = useMemo<ReadonlySet<string>>(() => {
    return resolvePermittedGitPanelDiffFetchKeys({
      reviewEntries,
      visibleSectionScopes,
      effectiveCollapsedFiles: collapsedFiles,
      settledDiffFetchKeys,
    });
  }, [collapsedFiles, reviewEntries, settledDiffFetchKeys, visibleSectionScopes]);
  const allFilesCollapsed = reviewEntries.length > 0
    && reviewEntries.every((entry) => collapsedFiles.has(entry.key));

  useEffect(() => {
    if (!modeRequest) {
      return;
    }
    setChangesFilter(modeRequest.mode);
    setCollapsedFiles(new Set());
  }, [modeRequest]);

  const handleToggleLayout = useCallback(() => {
    setLayout((value) => value === "split" ? "unified" : "split");
  }, []);

  const handleToggleWrap = useCallback(() => {
    setWrapLongLines((value) => !value);
  }, []);

  const handleToggleAllFiles = useCallback(() => {
    if (allFilesCollapsed) {
      setCollapsedFiles(new Set());
      return;
    }
    setCollapsedFiles(new Set(reviewEntries.map((entry) => entry.key)));
  }, [allFilesCollapsed, reviewEntries]);

  const toggleFileCollapsed = useCallback((key: string) => {
    setCollapsedFiles((current) => toggleReviewSetValue(current, key));
  }, []);

  const markDiffFetchSettled = useCallback((key: string) => {
    setSettledDiffFetchKeys((current) => {
      if (current.has(key)) {
        return current;
      }
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  const focusReviewFile = useCallback((entry: GitReviewFileEntry) => {
    setCollapsedFiles((current) => {
      if (!current.has(entry.key)) {
        return current;
      }
      const next = new Set(current);
      next.delete(entry.key);
      return next;
    });
    requestAnimationFrame(() => {
      document.getElementById(entry.id)?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, []);

  const lastTurnUndoDisabledReason = resolveLastTurnUndoDisabledReason({
    mode: changesFilter,
    lastTurnUndoCompleted,
    blockedReason: effectiveLastTurnRevertPatches.blockedReason,
    activeWorkspaceId,
    patchCount: effectiveLastTurnRevertPatches.entries.length,
  });
  const handleUndoLastTurn = useCallback(() => {
    if (
      changesFilter !== "last_turn"
      || lastTurnUndoDisabledReason
      || effectiveLastTurnRevertPatches.entries.length === 0
    ) {
      return;
    }
    const confirmed = typeof window === "undefined"
      || window.confirm(`Undo file changes from the last turn? This will reverse ${lastTurnPatchFileCount} file${lastTurnPatchFileCount === 1 ? "" : "s"} as one operation.`);
    if (!confirmed) {
      return;
    }
    void revertPatchesMutation.mutateAsync({
      sourceLabel: "last turn",
      entries: effectiveLastTurnRevertPatches.entries,
    }).then(() => {
      if (lastTurn?.turnId) {
        setUndoneTurnIds((current) => {
          if (current.has(lastTurn.turnId)) {
            return current;
          }
          const next = new Set(current);
          next.add(lastTurn.turnId);
          return next;
        });
      }
      showToast("Undid last turn file changes.", "info");
    }).catch((error) => {
      showToast(formatGitPanelUndoError(error));
    });
  }, [
    changesFilter,
    effectiveLastTurnRevertPatches.entries,
    lastTurn?.turnId,
    lastTurnPatchFileCount,
    lastTurnUndoDisabledReason,
    revertPatchesMutation,
    showToast,
  ]);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <GitPanelHeader
        changesFilter={changesFilter}
        visibleChangedCount={visibleChangedCount}
        additions={aggregateStats.additions}
        deletions={aggregateStats.deletions}
        isRuntimeReady={isRuntimeReady}
        branchRefs={branchRefs}
        baseRef={baseRef}
        currentBranch={currentBranch}
        layout={layout}
        wrapLongLines={wrapLongLines}
        allFilesCollapsed={allFilesCollapsed}
        reviewEntries={reviewEntries}
        onFilterChange={setChangesFilter}
        onBaseRefChange={setSelectedBaseRef}
        onToggleLayout={handleToggleLayout}
        onToggleWrap={handleToggleWrap}
        onToggleAllFiles={handleToggleAllFiles}
        onFocusFile={focusReviewFile}
        onRefresh={() => void refetch()}
        onOpenPublish={shellActions ? shellActions.openPublishDialog : null}
      />

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <GitPanelReviewBody
          changesFilter={changesFilter}
          baseRef={baseRef}
          isLoading={isLoading}
          errorMessage={errorMessage}
          runtimeBlockedReason={runtimeBlockedReason}
          hasReviewEntries={hasReviewEntries}
          lastTurnPatchFileCount={lastTurnPatchFileCount}
          lastTurnUndoDisabledReason={lastTurnUndoDisabledReason}
          lastTurnUndoBusy={revertPatchesMutation.isPending}
          diffPolicySummary={diffPolicySummary}
          sections={sections}
          activeWorkspaceId={activeWorkspaceId}
          layout={layout}
          wrapLongLines={wrapLongLines}
          collapsedFiles={collapsedFiles}
          isRuntimeReady={isRuntimeReady}
          permittedDiffFetchKeys={permittedDiffFetchKeys}
          openFile={openFile}
          onRefresh={() => void refetch()}
          onUndoLastTurn={handleUndoLastTurn}
          onToggleFileCollapsed={toggleFileCollapsed}
          onDiffFetchSettled={markDiffFetchSettled}
          diffTimingOptions={diffReviewMeasurement.diffTimingOptions}
          measurementOperationId={diffReviewMeasurement.operationId}
        />
      </div>
    </div>
  );
}
