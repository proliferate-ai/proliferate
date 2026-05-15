import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useStageGitPathsMutation,
  useUnstageGitPathsMutation,
} from "@anyharness/sdk-react";
import { GitPanelHeader } from "./GitPanelHeader";
import { GitReviewFileRow } from "./GitReviewFileRow";
import { GitReviewFileTree } from "./GitReviewFileTree";
import { Button } from "@/components/ui/Button";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { CheckCircleFilled, ChevronRight, GitBranchIcon, RefreshCw } from "@/components/ui/icons";
import { AttachedPaneShell } from "@/components/workspace/pane/AttachedPaneShell";
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
  buildGitReviewFileEntries,
  gitReviewEntryForFile,
  type GitReviewFileEntry,
} from "@/lib/domain/workspaces/changes/git-review-entries";
import { useGitPanelUiStore } from "@/stores/editor/git-panel-ui-store";

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
  const visibleSections = useMemo(
    () => sections.filter((section) => !collapsedSections.has(section.scope)),
    [collapsedSections, sections],
  );
  const allFilesCollapsed = reviewEntries.length > 0
    && reviewEntries.every((entry) => collapsedFiles.has(entry.key));

  useEffect(() => {
    if (!modeRequest) {
      return;
    }
    setChangesFilter(modeRequest.mode);
    setCollapsedSections(new Set());
    setCollapsedFiles(new Set());
  }, [modeRequest]);

  const handleToggleLayout = useCallback(() => {
    setLayout((value) => value === "split" ? "unified" : "split");
  }, []);

  const handleToggleWrap = useCallback(() => {
    setWrapLongLines((value) => !value);
  }, []);

  const handleToggleAllFiles = useCallback(() => {
    setCollapsedFiles((current) => {
      const allCollapsed = reviewEntries.length > 0
        && reviewEntries.every((entry) => current.has(entry.key));
      if (allCollapsed) {
        return new Set();
      }
      return new Set(reviewEntries.map((entry) => entry.key));
    });
  }, [reviewEntries]);

  const toggleSectionCollapsed = useCallback((scope: GitPanelReviewScope) => {
    setCollapsedSections((current) => toggleSetValue(current, scope));
  }, []);

  const toggleFileCollapsed = useCallback((key: string) => {
    setCollapsedFiles((current) => toggleSetValue(current, key));
  }, []);

  const focusReviewFile = useCallback((entry: GitReviewFileEntry) => {
    setCollapsedSections((current) => {
      if (!current.has(entry.sectionScope)) {
        return current;
      }
      const next = new Set(current);
      next.delete(entry.sectionScope);
      return next;
    });
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

      <AttachedPaneShell
        side="right"
        attachedOpen={canShowFileTree}
        defaultAttachedWidth={184}
        minAttachedWidth={152}
        maxAttachedWidth={320}
        resizeLabel="Resize file navigator"
        attached={(
          <GitReviewFileTree
            sections={sections}
            reviewEntries={reviewEntries}
            onSelectFile={focusReviewFile}
          />
        )}
      >
        <AutoHideScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="px-2 py-2">
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
                          collapsed={collapsedFiles.has(entry.key)}
                          isRuntimeReady={isRuntimeReady}
                          onToggleCollapsed={() => toggleFileCollapsed(entry.key)}
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
      </AttachedPaneShell>
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
