import type { GitBranchRef } from "@anyharness/sdk";
import { GitReviewOptionsMenu } from "./GitReviewOptionsMenu";
import { GitReviewBaseSelector } from "./GitReviewBaseSelector";
import { GitReviewTargetSelector } from "./GitReviewTargetSelector";
import { FileCode, SplitPanel } from "@proliferate/ui/icons";
import { PaneIconButton } from "@proliferate/ui/layout/PaneIconButton";
import type { GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";

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
  onFilterChange: (mode: GitPanelMode) => void;
  onBaseRefChange: (baseRef: string | null) => void;
  onToggleLayout: () => void;
  onToggleWrap: () => void;
  onToggleFileTree: () => void;
  onToggleAllFiles: () => void;
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
  onFilterChange,
  onBaseRefChange,
  onToggleLayout,
  onToggleWrap,
  onToggleFileTree,
  onToggleAllFiles,
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
          <SplitPanel className="size-3.5" />
        </PaneIconButton>
        <PaneIconButton
          label={fileTreeOpen ? "Hide files" : "Show files"}
          aria-pressed={fileTreeOpen}
          active={fileTreeOpen}
          onClick={onToggleFileTree}
        >
          <FileCode className="size-3.5" />
        </PaneIconButton>
      </div>
    </div>
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
      className="flex shrink-0 items-center gap-1 text-[10px] font-medium leading-none tabular-nums"
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
