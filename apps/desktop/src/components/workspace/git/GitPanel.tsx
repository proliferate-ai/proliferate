import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useRevertGitPatchesMutation,
  useStageGitPathsMutation,
  useUnstageGitPathsMutation,
} from "@anyharness/sdk-react";
import { GitPanelHeader } from "./GitPanelHeader";
import { GitReviewFileRow } from "./GitReviewFileRow";
import { GitReviewFileTree } from "./GitReviewFileTree";
import {
  formatGitPanelUndoError,
  GitLastTurnUndoAction,
  GitReviewDiffPolicyNotice,
  GitReviewNoChangesState,
  GitReviewSectionHeader,
} from "./GitPanelReviewChrome";
import { PaneSideOverlay } from "@/components/workspace/pane/PaneSideOverlay";
import { useDiffReviewMeasurement } from "@/hooks/workspaces/files/use-diff-review-measurement";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useWorkspaceFileContext } from "@/hooks/workspaces/files/derived/use-workspace-file-context";
import { useGitPanelState } from "@/hooks/workspaces/derived/use-git-panel-state";
import {
  type GitPanelMode,
  type GitPanelReviewScope,
  type GitPanelSection,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import {
  GIT_DIFF_FETCH_CONCURRENCY_LIMIT,
  resolveDiffDisplayPolicy,
  summarizeDiffDisplayPolicies,
} from "@/lib/domain/workspaces/changes/diff-display-policy";
import {
  buildGitReviewFileEntries,
  gitReviewEntryForFile,
  type GitReviewFileEntry,
} from "@/lib/domain/workspaces/changes/git-review-entries";
import { useGitPanelUiStore } from "@/stores/editor/git-panel-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_COLLAPSED_FILE_KEYS = new Set<string>();
const EMPTY_LAST_TURN_REVERT_PATCHES = {
  entries: [],
  blockedReason: null,
};

export function GitPanel() {
  const diffReviewMeasurement = useDiffReviewMeasurement();
  if (diffReviewMeasurement.deferQueryMount) {
    return (
      <div className="flex h-full min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
        <p className="px-4 py-8 text-center text-xs text-sidebar-muted-foreground">
          Loading changes
        </p>
      </div>
    );
  }

  return <GitPanelContent diffReviewMeasurement={diffReviewMeasurement} />;
}

type DiffReviewMeasurementState = ReturnType<typeof useDiffReviewMeasurement>;

function GitPanelContent({
  diffReviewMeasurement,
}: {
  diffReviewMeasurement: DiffReviewMeasurementState;
}) {
  const [changesFilter, setChangesFilter] = useState<GitPanelMode>("unstaged");
  const [selectedBaseRef, setSelectedBaseRef] = useState<string | null>(null);
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [wrapLongLines, setWrapLongLines] = useState(false);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<GitPanelReviewScope>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [fileCollapseTouched, setFileCollapseTouched] = useState(false);
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
  const stageMutation = useStageGitPathsMutation({ workspaceId: activeWorkspaceId });
  const unstageMutation = useUnstageGitPathsMutation({ workspaceId: activeWorkspaceId });
  const revertPatchesMutation = useRevertGitPatchesMutation({ workspaceId: activeWorkspaceId });
  const showToast = useToastStore((state) => state.show);
  const effectiveLastTurnRevertPatches =
    lastTurnRevertPatches ?? EMPTY_LAST_TURN_REVERT_PATCHES;
  const lastTurnUndoCompleted = Boolean(lastTurn?.turnId && undoneTurnIds.has(lastTurn.turnId));
  const reviewEntries = useMemo(
    () => buildGitReviewFileEntries(sections),
    [sections],
  );
  const hasReviewEntries = reviewEntries.length > 0;
  const canShowFileTree = fileTreeOpen
    && !isLoading
    && !errorMessage
    && !runtimeBlockedReason
    && hasReviewEntries;
  const aggregateStats = useMemo(
    () => summarizeGitPanelSectionStats(sections),
    [sections],
  );
  const autoCollapsedFiles = useMemo<ReadonlySet<string>>(() => {
    if (fileCollapseTouched) {
      return EMPTY_COLLAPSED_FILE_KEYS;
    }
    const collapsedKeys = reviewEntries.map((entry) => entry.key);
    return collapsedKeys.length === 0
      ? EMPTY_COLLAPSED_FILE_KEYS
      : new Set(collapsedKeys);
  }, [fileCollapseTouched, reviewEntries]);
  const effectiveCollapsedFiles = useMemo<ReadonlySet<string>>(() => {
    if (autoCollapsedFiles.size === 0) {
      return collapsedFiles;
    }
    const next = new Set(collapsedFiles);
    for (const key of autoCollapsedFiles) {
      next.add(key);
    }
    return next;
  }, [autoCollapsedFiles, collapsedFiles]);
  const visibleSections = useMemo(
    () => sections.filter((section) => !collapsedSections.has(section.scope)),
    [collapsedSections, sections],
  );
  const visibleSectionScopes = useMemo(
    () => new Set(visibleSections.map((section) => section.scope)),
    [visibleSections],
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
    () => [
      activeWorkspaceId ?? "",
      baseRef ?? "",
      changesFilter,
      reviewEntries.map((entry) => entry.key).join("\n"),
    ].join("\u001f"),
    [activeWorkspaceId, baseRef, changesFilter, reviewEntries],
  );
  useEffect(() => {
    setSettledDiffFetchKeys(new Set());
  }, [diffFetchScopeKey]);
  const permittedDiffFetchKeys = useMemo<ReadonlySet<string>>(() => {
    const permitted = new Set(settledDiffFetchKeys);
    let activeFetchCount = 0;
    for (const entry of reviewEntries) {
      if (activeFetchCount >= GIT_DIFF_FETCH_CONCURRENCY_LIMIT) {
        break;
      }
      if (permitted.has(entry.key) || !visibleSectionScopes.has(entry.sectionScope)) {
        continue;
      }
      const currentDiff = entry.file.currentDiff;
      if (!currentDiff || effectiveCollapsedFiles.has(entry.key)) {
        continue;
      }
      const displayPolicy = resolveDiffDisplayPolicy({
        path: currentDiff.path,
        additions: currentDiff.additions,
        deletions: currentDiff.deletions,
      });
      if (!displayPolicy.canFetchInline) {
        continue;
      }
      permitted.add(entry.key);
      activeFetchCount += 1;
    }
    return permitted;
  }, [effectiveCollapsedFiles, reviewEntries, settledDiffFetchKeys, visibleSectionScopes]);
  const allFilesCollapsed = reviewEntries.length > 0
    && reviewEntries.every((entry) => effectiveCollapsedFiles.has(entry.key));

  useEffect(() => {
    if (!modeRequest) {
      return;
    }
    setChangesFilter(modeRequest.mode);
    setCollapsedSections(new Set());
    setCollapsedFiles(new Set());
    setFileCollapseTouched(false);
  }, [modeRequest]);

  const handleToggleLayout = useCallback(() => {
    setLayout((value) => value === "split" ? "unified" : "split");
  }, []);

  const handleToggleWrap = useCallback(() => {
    setWrapLongLines((value) => !value);
  }, []);

  const handleToggleAllFiles = useCallback(() => {
    setFileCollapseTouched(true);
    if (allFilesCollapsed) {
      setCollapsedFiles(new Set());
      return;
    }
    setCollapsedFiles(new Set(reviewEntries.map((entry) => entry.key)));
  }, [allFilesCollapsed, reviewEntries]);

  const toggleSectionCollapsed = useCallback((scope: GitPanelReviewScope) => {
    setCollapsedSections((current) => toggleSetValue(current, scope));
  }, []);

  const toggleFileCollapsed = useCallback((key: string) => {
    setFileCollapseTouched(true);
    setCollapsedFiles(() => toggleSetValue(new Set(effectiveCollapsedFiles), key));
  }, [effectiveCollapsedFiles]);

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
    setFileCollapseTouched(true);
    setCollapsedSections((current) => {
      if (!current.has(entry.sectionScope)) {
        return current;
      }
      const next = new Set(current);
      next.delete(entry.sectionScope);
      return next;
    });
    setCollapsedFiles((current) => {
      if (!effectiveCollapsedFiles.has(entry.key)) {
        return current;
      }
      const next = new Set(effectiveCollapsedFiles);
      next.delete(entry.key);
      return next;
    });
    requestAnimationFrame(() => {
      document.getElementById(entry.id)?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, [effectiveCollapsedFiles]);

  const lastTurnUndoDisabledReason = changesFilter === "last_turn"
    ? lastTurnUndoCompleted
      ? "Undo has already been applied for this turn."
      : effectiveLastTurnRevertPatches.blockedReason
      ?? (!activeWorkspaceId ? "Undo is unavailable until a workspace is selected." : null)
      ?? (effectiveLastTurnRevertPatches.entries.length === 0
        ? "Undo is unavailable because this turn has no complete file patches."
        : null)
    : null;
  const handleUndoLastTurn = useCallback(() => {
    if (
      changesFilter !== "last_turn"
      || lastTurnUndoDisabledReason
      || effectiveLastTurnRevertPatches.entries.length === 0
    ) {
      return;
    }
    const fileCount = new Set(effectiveLastTurnRevertPatches.entries.map((entry) => entry.path)).size;
    const confirmed = typeof window === "undefined"
      || window.confirm(`Undo file changes from the last turn? This will reverse ${fileCount} file${fileCount === 1 ? "" : "s"} as one operation.`);
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
        layout={layout}
        wrapLongLines={wrapLongLines}
        fileTreeOpen={fileTreeOpen}
        allFilesCollapsed={allFilesCollapsed}
        onFilterChange={setChangesFilter}
        onBaseRefChange={setSelectedBaseRef}
        onToggleLayout={handleToggleLayout}
        onToggleWrap={handleToggleWrap}
        onToggleFileTree={() => setFileTreeOpen((value) => !value)}
        onToggleAllFiles={handleToggleAllFiles}
        onRefresh={() => void refetch()}
      />

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          id="review-diffs-collapsed"
          data-app-action-review-scroll=""
          data-thread-find-target="review"
          className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-2 pb-3"
        >
          <div className="relative flex min-h-full flex-col pt-2">
            <span
              aria-hidden="true"
              data-app-action-review-metrics-probe=""
              className="pointer-events-none absolute left-0 top-0 size-px opacity-0"
            />
            {isLoading && (
              <div className="space-y-2 px-2 py-4">
                <div className="h-3 w-32 animate-pulse rounded bg-sidebar-accent" />
                <div className="h-3 w-48 animate-pulse rounded bg-sidebar-accent" />
                <div className="h-3 w-40 animate-pulse rounded bg-sidebar-accent" />
              </div>
            )}
            {errorMessage && (
              <p className="px-2 py-4 text-xs text-destructive">{errorMessage}</p>
            )}
            {!errorMessage && runtimeBlockedReason && (
              <p className="px-2 py-4 text-xs text-sidebar-muted-foreground">
                {runtimeBlockedReason}
              </p>
            )}
            {!isLoading && !errorMessage && !runtimeBlockedReason && !hasReviewEntries && (
              <GitReviewNoChangesState
                mode={changesFilter}
                baseRef={baseRef}
                onRefresh={() => void refetch()}
              />
            )}

            {!isLoading && !errorMessage && !runtimeBlockedReason && hasReviewEntries && (
              <div className="flex flex-col gap-1.5">
                {changesFilter === "last_turn" && (
                  <GitLastTurnUndoAction
                    fileCount={new Set(effectiveLastTurnRevertPatches.entries.map((entry) => entry.path)).size}
                    disabledReason={lastTurnUndoDisabledReason}
                    busy={revertPatchesMutation.isPending}
                    onUndo={handleUndoLastTurn}
                  />
                )}
                {diffPolicySummary.total > 0 && (
                  <GitReviewDiffPolicyNotice summary={diffPolicySummary} />
                )}
                {sections.map((section) => (
                  <div key={section.scope} className="flex flex-col gap-1">
                    {changesFilter === "working_tree_composite" && (
                      <GitReviewSectionHeader
                        section={section}
                        collapsed={collapsedSections.has(section.scope)}
                        onToggle={() => toggleSectionCollapsed(section.scope)}
                      />
                    )}
                    {visibleSections.some((visibleSection) => visibleSection.scope === section.scope)
                      && section.files.map((file) => {
                        const entry = gitReviewEntryForFile(section.scope, file);
                        return (
                          <GitReviewFileRow
                            key={entry.key}
                            id={entry.id}
                            workspaceId={activeWorkspaceId}
                            sectionScope={section.scope}
                            file={file}
                            baseRef={baseRef}
                            layout={layout}
                            wrapLongLines={wrapLongLines}
                            collapsed={effectiveCollapsedFiles.has(entry.key)}
                            isRuntimeReady={isRuntimeReady}
                            fetchDiff={permittedDiffFetchKeys.has(entry.key)}
                            onToggleCollapsed={() => toggleFileCollapsed(entry.key)}
                            onDiffFetchSettled={() => markDiffFetchSettled(entry.key)}
                            openFile={openFile}
                            stagePath={(path) => stageMutation.mutateAsync([path])}
                            unstagePath={(path) => unstageMutation.mutateAsync([path])}
                            diffTimingOptions={diffReviewMeasurement.diffTimingOptions}
                            measurementOperationId={diffReviewMeasurement.operationId}
                          />
                        );
                      })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <PaneSideOverlay
          open={canShowFileTree}
          label="Changed files"
          widthClassName="w-[min(320px,calc(100%-1rem))]"
          dataAttribute="git-file-tree-overlay"
          onClose={() => setFileTreeOpen(false)}
        >
          <GitReviewFileTree
            sections={sections}
            reviewEntries={reviewEntries}
            onSelectFile={focusReviewFile}
          />
        </PaneSideOverlay>
      </div>
    </div>
  );
}

function summarizeGitPanelSectionStats(sections: readonly GitPanelSection[]): {
  additions: number;
  deletions: number;
} {
  return sections.reduce(
    (stats, section) => {
      for (const file of section.files) {
        stats.additions += file.currentDiff?.additions ?? 0;
        stats.deletions += file.currentDiff?.deletions ?? 0;
      }
      return stats;
    },
    { additions: 0, deletions: 0 },
  );
}

function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}
