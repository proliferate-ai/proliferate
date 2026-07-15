import { useState } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import { GitReviewOptionsMenu } from "./GitReviewOptionsMenu";
import { GitReviewBaseSelector } from "./GitReviewBaseSelector";
import { GitReviewTargetSelector } from "./GitReviewTargetSelector";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  ChevronDown,
  CollapseAll,
  ExpandAll,
  GitCommit,
  Search,
} from "@proliferate/ui/icons";
import { PaneIconButton } from "@proliferate/ui/layout/PaneIconButton";
import { PopoverButton, POPOVER_SURFACE_CLASS } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import type { PublishIntent } from "@/lib/domain/workspaces/creation/publish-workflow-model";
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
  currentBranch: string | null;
  layout: "unified" | "split";
  wrapLongLines: boolean;
  allFilesCollapsed: boolean;
  reviewEntries: readonly GitReviewFileEntry[];
  onFilterChange: (mode: GitPanelMode) => void;
  onBaseRefChange: (baseRef: string | null) => void;
  onToggleLayout: () => void;
  onToggleWrap: () => void;
  onToggleAllFiles: () => void;
  onFocusFile: (entry: GitReviewFileEntry) => void;
  onRefresh: () => void;
  onOpenPublish: ((intent: PublishIntent) => void) | null;
}

export function GitPanelHeader({
  changesFilter,
  visibleChangedCount,
  additions,
  deletions,
  isRuntimeReady,
  branchRefs,
  baseRef,
  currentBranch,
  layout,
  wrapLongLines,
  allFilesCollapsed,
  reviewEntries,
  onFilterChange,
  onBaseRefChange,
  onToggleLayout,
  onToggleWrap,
  onToggleAllFiles,
  onFocusFile,
  onRefresh,
  onOpenPublish,
}: GitPanelHeaderProps) {
  const showTargetSelector = changesFilter === "branch";

  return (
    <div
      className="z-20 flex shrink-0 flex-col gap-0.5 [container-name:review-header] [container-type:inline-size] border-b border-sidebar-border/70 bg-sidebar-background px-2 py-1 text-sidebar-muted-foreground"
    >
      <div className="flex min-h-7 min-w-0 items-center gap-1">
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
        <div className="ms-auto flex shrink-0 items-center gap-px">
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
            layout={layout}
            isRuntimeReady={isRuntimeReady}
            onToggleAllFiles={onToggleAllFiles}
            onToggleWrap={onToggleWrap}
            onToggleLayout={onToggleLayout}
            onRefresh={onRefresh}
          />
        </div>
      </div>
      {(currentBranch || onOpenPublish) && (
        <div className="flex min-h-6 min-w-0 items-center gap-1.5 pb-0.5">
          <span className="flex min-w-0 items-center gap-1 truncate px-1.5 text-sm text-sidebar-muted-foreground">
            {currentBranch && <span className="truncate">{currentBranch}</span>}
            {changesFilter === "branch" && baseRef && (
              <>
                <span aria-hidden="true" className="shrink-0">→</span>
                <span className="truncate">{baseRef}</span>
              </>
            )}
          </span>
          {onOpenPublish && <GitReviewCommitSplitButton onOpenPublish={onOpenPublish} />}
        </div>
      )}
    </div>
  );
}

function GitReviewCommitSplitButton({
  onOpenPublish,
}: {
  onOpenPublish: (intent: PublishIntent) => void;
}) {
  const segmentClass =
    "h-6 border border-sidebar-border bg-sidebar-background px-2 py-0 text-sm leading-none text-sidebar-foreground hover:bg-sidebar-accent";
  return (
    <div className="ms-auto flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onOpenPublish("publish")}
        className={`${segmentClass} gap-1 rounded-md rounded-e-none border-e-0`}
      >
        <GitCommit className="size-3.5" />
        <span className="hidden [@container_review-header_(min-width:280px)]:inline">
          Commit or push
        </span>
      </Button>
      <PopoverButton
        align="end"
        className={`min-w-[200px] ${POPOVER_SURFACE_CLASS}`}
        trigger={(
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="More git actions"
            className={`${segmentClass} w-5 rounded-md rounded-s-none px-0 text-sidebar-muted-foreground`}
          >
            <ChevronDown className="size-3" />
          </Button>
        )}
      >
        {(close) => (
          <div className="flex flex-col gap-px">
            <PopoverMenuItem
              label="Commit…"
              onClick={() => {
                onOpenPublish("commit");
                close();
              }}
            />
            <PopoverMenuItem
              label="Create pull request…"
              onClick={() => {
                onOpenPublish("pull_request");
                close();
              }}
            />
          </div>
        )}
      </PopoverButton>
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
