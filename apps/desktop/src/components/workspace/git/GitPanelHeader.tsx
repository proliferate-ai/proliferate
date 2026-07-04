import { useState } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import { GitReviewOptionsMenu } from "./GitReviewOptionsMenu";
import { GitReviewBaseSelector } from "./GitReviewBaseSelector";
import { GitReviewTargetSelector } from "./GitReviewTargetSelector";
import { CollapseAll, Columns2, ExpandAll, FolderTree, Search } from "@proliferate/ui/icons";
import { PaneIconButton } from "@proliferate/ui/layout/PaneIconButton";
import { PopoverButton, POPOVER_SURFACE_CLASS } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import type { GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";
import type { GitReviewFileEntry } from "@/lib/domain/workspaces/changes/git-review-entries";

interface GitPanelHeaderProps {
  changesFilter: GitPanelMode;
  visibleChangedCount: number;
  additions: number;
  deletions: number;
  isRuntimeReady: boolean;
  branchRefs: readonly GitBranchRef[];
  baseRef: string | null;
  layout: "unified" | "split";
  wrapLongLines: boolean;
  fileTreeOpen: boolean;
  allFilesCollapsed: boolean;
  reviewEntries: readonly GitReviewFileEntry[];
  onFilterChange: (mode: GitPanelMode) => void;
  onBaseRefChange: (baseRef: string | null) => void;
  onToggleLayout: () => void;
  onToggleWrap: () => void;
  onToggleFileTree: () => void;
  onToggleAllFiles: () => void;
  onFocusFile: (entry: GitReviewFileEntry) => void;
  onRefresh: () => void;
}

export function GitPanelHeader({
  changesFilter,
  visibleChangedCount,
  additions,
  deletions,
  isRuntimeReady,
  branchRefs,
  baseRef,
  layout,
  wrapLongLines,
  fileTreeOpen,
  allFilesCollapsed,
  reviewEntries,
  onFilterChange,
  onBaseRefChange,
  onToggleLayout,
  onToggleWrap,
  onToggleFileTree,
  onToggleAllFiles,
  onFocusFile,
  onRefresh,
}: GitPanelHeaderProps) {
  const showTargetSelector = changesFilter === "branch";

  return (
    <div
      className="z-20 grid min-h-10 shrink-0 [container-name:review-header] [container-type:inline-size] grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-b border-sidebar-border/70 bg-sidebar-background px-2 py-1 text-sidebar-muted-foreground"
    >
      <div className="flex w-full min-w-0 flex-col overflow-hidden text-base">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          <GitReviewBaseSelector
            activeMode={changesFilter}
            changedCount={visibleChangedCount}
            onSelect={onFilterChange}
          />
          {showTargetSelector && (
            <GitReviewTargetSelector
              mode={changesFilter}
              baseRef={baseRef}
              branchRefs={branchRefs}
              isRuntimeReady={isRuntimeReady}
              onSelect={onBaseRefChange}
            />
          )}
          <GitPanelAggregateStats additions={additions} deletions={deletions} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-px">
        <PaneIconButton
          label={allFilesCollapsed ? "Expand all diffs" : "Collapse all diffs"}
          aria-pressed={allFilesCollapsed}
          onClick={onToggleAllFiles}
        >
          {allFilesCollapsed
            ? <ExpandAll className="size-3.5" />
            : <CollapseAll className="size-3.5" />}
        </PaneIconButton>
        <GitReviewJumpToFileMenu
          reviewEntries={reviewEntries}
          onFocusFile={onFocusFile}
        />
        <GitReviewOptionsMenu
          allFilesCollapsed={allFilesCollapsed}
          wrapLongLines={wrapLongLines}
          isRuntimeReady={isRuntimeReady}
          onToggleAllFiles={onToggleAllFiles}
          onToggleWrap={onToggleWrap}
          onRefresh={onRefresh}
        />
        <PaneIconButton
          label={layout === "split" ? "Use unified diff" : "Use split diff"}
          onClick={onToggleLayout}
        >
          <Columns2 className="size-3.5" />
        </PaneIconButton>
        <PaneIconButton
          label={fileTreeOpen ? "Hide files" : "Show files"}
          aria-pressed={fileTreeOpen}
          active={fileTreeOpen}
          onClick={onToggleFileTree}
        >
          <FolderTree className="size-3.5" />
        </PaneIconButton>
      </div>
    </div>
  );
}

function GitReviewJumpToFileMenu({
  reviewEntries,
  onFocusFile,
}: {
  reviewEntries: readonly GitReviewFileEntry[];
  onFocusFile: (entry: GitReviewFileEntry) => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filteredEntries = query
    ? reviewEntries.filter((entry) =>
        entry.file.displayPath.toLowerCase().includes(query)
        || entry.file.path.toLowerCase().includes(query))
    : reviewEntries;

  return (
    <PopoverButton
      trigger={(
        <PaneIconButton label="Jump to file" disabled={reviewEntries.length === 0}>
          <Search className="size-3.5" />
        </PaneIconButton>
      )}
      align="end"
      className={`w-72 ${POPOVER_SURFACE_CLASS}`}
      onOpenChange={(open: boolean) => {
        if (!open) {
          setSearch("");
        }
      }}
    >
      {(close: () => void) => (
        <div className="flex max-h-80 flex-col">
          <PopoverSearchField
            value={search}
            onChange={setSearch}
            placeholder="Jump to file"
            ariaLabel="Filter changed files"
            autoFocus
          />
          <div className="h-px shrink-0 bg-border" />
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {filteredEntries.length === 0 ? (
              <p className="px-2.5 py-2 text-ui-sm text-muted-foreground">No files</p>
            ) : (
              filteredEntries.map((entry) => {
                const baseName = entry.file.displayPath.split("/").pop()
                  ?? entry.file.displayPath;
                const dirPath = entry.file.displayPath.slice(
                  0,
                  entry.file.displayPath.length - baseName.length,
                ).replace(/\/$/, "");
                const additions = entry.file.currentDiff?.additions ?? 0;
                const deletions = entry.file.currentDiff?.deletions ?? 0;
                return (
                  <PopoverMenuItem
                    key={entry.key}
                    title={entry.file.displayPath}
                    label={(
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate">{baseName}</span>
                        {dirPath && (
                          <span className="min-w-0 truncate text-base text-muted-foreground">
                            {dirPath}
                          </span>
                        )}
                      </span>
                    )}
                    trailing={(additions > 0 || deletions > 0) ? (
                      <span className="inline-flex items-center gap-1 tabular-nums tracking-tight">
                        {additions > 0 && <span className="text-git-green">+{additions}</span>}
                        {deletions > 0 && <span className="text-git-red">-{deletions}</span>}
                      </span>
                    ) : undefined}
                    density="compact"
                    onClick={() => {
                      onFocusFile(entry);
                      close();
                    }}
                  />
                );
              })
            )}
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

function GitPanelAggregateStats({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 text-sm font-medium leading-none tabular-nums"
      aria-label={`${additions} additions, ${deletions} deletions`}
    >
      <span className={additions > 0 ? "text-git-green" : "text-sidebar-muted-foreground/70"}>
        +{additions}
      </span>
      <span className={deletions > 0 ? "text-git-red" : "text-sidebar-muted-foreground/70"}>
        -{deletions}
      </span>
    </div>
  );
}
