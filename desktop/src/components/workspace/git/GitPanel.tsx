import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useStageGitPathsMutation,
  useUnstageGitPathsMutation,
} from "@anyharness/sdk-react";
import { GitPanelHeader } from "./GitPanelHeader";
import { GitReviewFileRow } from "./GitReviewFileRow";
import { GitReviewFileTree } from "./GitReviewFileTree";
import { Button } from "@proliferate/ui/primitives/Button";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { CheckCircleFilled, ChevronRight, GitBranchIcon, RefreshCw } from "@/components/ui/icons";
import { PaneSideOverlay } from "@/components/workspace/pane/PaneSideOverlay";
import { useDiffReviewMeasurement } from "@/hooks/workspaces/files/use-diff-review-measurement";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useWorkspaceFileContext } from "@/hooks/workspaces/files/derived/use-workspace-file-context";
import { useGitPanelState } from "@/hooks/workspaces/derived/use-git-panel-state";
import {
  gitPanelEmptyDescription,
  gitPanelEmptyMessage,
  type GitPanelMode,
  type GitPanelReviewScope,
  type GitPanelSection,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import {
  GIT_DIFF_FETCH_CONCURRENCY_LIMIT,
  resolveDiffDisplayPolicy,
  summarizeDiffDisplayPolicies,
  type DiffDisplayPolicySummary,
} from "@/lib/domain/workspaces/changes/diff-display-policy";
import {
  buildGitReviewFileEntries,
  gitReviewEntryForFile,
  type GitReviewFileEntry,
} from "@/lib/domain/workspaces/changes/git-review-entries";
import { useGitPanelUiStore } from "@/stores/editor/git-panel-ui-store";

const INITIAL_EXPANDED_DIFF_FILE_LIMIT = 3;
const EMPTY_COLLAPSED_FILE_KEYS = new Set<string>();

export function GitPanel() {
  const diffReviewMeasurement = useDiffReviewMeasurement();
  if (diffReviewMeasurement.deferQueryMount) {
    return (
      <div className="flex h-full min-w-0 flex-col overflow-hidden bg-sidebar-background text-sidebar-foreground">
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
  const [wrapLongLines, setWrapLongLines] = useState(true);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<GitPanelReviewScope>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [fileCollapseTouched, setFileCollapseTouched] = useState(false);
  const [settledDiffFetchKeys, setSettledDiffFetchKeys] = useState<Set<string>>(new Set());
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
    refetch,
  } = useGitPanelState(changesFilter, {
    baseRefOverride: selectedBaseRef,
    statusTimingOptions: diffReviewMeasurement.statusTimingOptions,
    branchDiffFilesTimingOptions: diffReviewMeasurement.branchDiffFilesTimingOptions,
  });
  const stageMutation = useStageGitPathsMutation({ workspaceId: activeWorkspaceId });
  const unstageMutation = useUnstageGitPathsMutation({ workspaceId: activeWorkspaceId });
  const canShowFileTree = fileTreeOpen
    && !isLoading
    && !errorMessage
    && !runtimeBlockedReason
    && sections.length > 0;

  const reviewEntries = useMemo(
    () => buildGitReviewFileEntries(sections),
    [sections],
  );
  const autoCollapsedFiles = useMemo<ReadonlySet<string>>(() => {
    if (fileCollapseTouched) {
      return EMPTY_COLLAPSED_FILE_KEYS;
    }
    const collapsedKeys = reviewEntries.flatMap((entry, index) => {
      const currentDiff = entry.file.currentDiff;
      const displayPolicy = currentDiff
        ? resolveDiffDisplayPolicy({
            path: currentDiff.path,
            additions: currentDiff.additions,
            deletions: currentDiff.deletions,
          })
        : null;
      const hasKnownChangedLines = currentDiff
        ? currentDiff.additions + currentDiff.deletions > 0
        : false;
      const shouldResolveInline = Boolean(
        currentDiff
        && !hasKnownChangedLines
        && !displayPolicy?.shouldAutoCollapse,
      );
      return Boolean(displayPolicy?.shouldAutoCollapse)
        || (index >= INITIAL_EXPANDED_DIFF_FILE_LIMIT && !shouldResolveInline)
        ? [entry.key]
        : [];
    });
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

  return (
    <div className="flex h-full flex-col bg-sidebar-background text-sidebar-foreground">
      <GitPanelHeader
        changesFilter={changesFilter}
        visibleChangedCount={visibleChangedCount}
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
        <AutoHideScrollArea
          className="h-full min-h-0 min-w-0"
          viewportClassName="px-2 pb-2"
          contentClassName="pt-2"
        >
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
          {!isLoading && !errorMessage && !runtimeBlockedReason && sections.length === 0 && (
            <GitReviewEmptyState
              mode={changesFilter}
              baseRef={baseRef}
              onRefresh={() => void refetch()}
            />
          )}

          {!isLoading && !errorMessage && !runtimeBlockedReason && sections.length > 0 && (
            <div className="flex flex-col gap-2">
              {diffPolicySummary.total > 0 && (
                <GitReviewDiffPolicyNotice summary={diffPolicySummary} />
              )}
              {sections.map((section) => (
                <div key={section.scope} className="flex flex-col gap-1.5">
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
        </AutoHideScrollArea>
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

function GitReviewDiffPolicyNotice({ summary }: { summary: DiffDisplayPolicySummary }) {
  const hiddenLabel = `${summary.total} large/generated diff${summary.total === 1 ? "" : "s"}`;
  const tooLargeLabel = summary.tooLargeInline > 0
    ? `${summary.tooLargeInline} too large to render inline`
    : null;
  return (
    <div className="rounded-md border border-sidebar-border/70 bg-sidebar-accent/35 px-2.5 py-2 text-xs leading-5 text-sidebar-muted-foreground">
      <span>
        {hiddenLabel} collapsed to keep review responsive.
      </span>
      {tooLargeLabel && (
        <span> {tooLargeLabel}; open the file to inspect those changes.</span>
      )}
    </div>
  );
}

function GitReviewEmptyState({
  mode,
  baseRef,
  onRefresh,
}: {
  mode: GitPanelMode;
  baseRef: string | null;
  onRefresh: () => void;
}) {
  const Icon = mode === "branch" ? GitBranchIcon : CheckCircleFilled;
  return (
    <div className="flex min-h-[260px] items-center justify-center px-4 py-8">
      <div className="flex max-w-[280px] flex-col items-center text-center">
        <div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-sidebar-border/70 bg-foreground/5 text-sidebar-muted-foreground">
          <Icon className="size-4" />
        </div>
        <p className="text-sm font-medium text-sidebar-foreground">
          {gitPanelEmptyMessage(mode)}
        </p>
        <p className="mt-1 text-pretty text-xs leading-5 text-sidebar-muted-foreground">
          {gitPanelEmptyDescription(mode, baseRef)}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="mt-4 h-7 gap-1.5 rounded-md border border-sidebar-border/70 px-2.5 text-xs text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </div>
    </div>
  );
}

function GitReviewSectionHeader({
  section,
  collapsed,
  onToggle,
}: {
  section: GitPanelSection;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="unstyled"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      <ChevronRight
        className={`size-3 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
      />
      <span className="min-w-0 flex-1 truncate">
        {section.label}
      </span>
      <span className="tabular-nums">{section.files.length}</span>
    </Button>
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
