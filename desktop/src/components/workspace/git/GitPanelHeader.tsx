import type { GitBranchRef } from "@anyharness/sdk";
import { GitReviewOptionsMenu } from "./GitReviewOptionsMenu";
import { GitReviewBaseSelector } from "./GitReviewBaseSelector";
import { GitReviewTargetSelector } from "./GitReviewTargetSelector";
import { ArrowRight, FileCode, SplitPanel } from "@/components/ui/icons";
import { PaneHeader, PaneIconButton } from "@/components/workspace/pane/PaneHeader";
import type { GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";

interface GitPanelHeaderProps {
  changesFilter: GitPanelMode;
  totalChangedCount: number;
  visibleChangedCount: number;
  isBranchMode: boolean;
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
  totalChangedCount,
  visibleChangedCount,
  isBranchMode,
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
  const activeBaseLabel = gitReviewBaseLabel(changesFilter);
  const countLabel = totalChangedCount === 0
    ? isBranchMode
      ? "No branch changes"
      : `No ${activeBaseLabel.toLowerCase()} changes`
    : `${visibleChangedCount} ${activeBaseLabel.toLowerCase()} file${visibleChangedCount !== 1 ? "s" : ""}`;
  const comparisonLabel = gitReviewComparisonLabel(changesFilter, baseRef);

  return (
    <PaneHeader
      left={(
        <>
        <GitReviewBaseSelector
          activeMode={changesFilter}
          changedCount={visibleChangedCount}
          onSelect={onFilterChange}
        />
        <ArrowRight className="size-3 shrink-0 text-sidebar-muted-foreground" />
        <GitReviewTargetSelector
          mode={changesFilter}
          baseRef={baseRef}
          branchRefs={branchRefs}
          isRuntimeReady={isRuntimeReady}
          onSelect={onBaseRefChange}
        />
        <span
          className="min-w-0 flex-1 truncate pl-1 text-[10px] leading-none text-sidebar-muted-foreground"
          title={comparisonLabel ? `${countLabel} · ${comparisonLabel}` : countLabel}
        >
          {countLabel}
        </span>
        </>
      )}
      right={(
        <>
        <PaneIconButton
          label={layout === "split" ? "Use unified diff" : "Use split diff"}
          tooltip={layout === "split" ? "Unified diff" : "Split diff"}
          onClick={onToggleLayout}
        >
          <SplitPanel className="size-3.5" />
        </PaneIconButton>
        <GitReviewOptionsMenu
          allFilesCollapsed={allFilesCollapsed}
          wrapLongLines={wrapLongLines}
          isRuntimeReady={isRuntimeReady}
          onToggleAllFiles={onToggleAllFiles}
          onToggleWrap={onToggleWrap}
          onRefresh={onRefresh}
        />
        <PaneIconButton
          label={fileTreeOpen ? "Hide files" : "Show files"}
          tooltip={fileTreeOpen ? "Hide files" : "Show files"}
          aria-pressed={fileTreeOpen}
          active={fileTreeOpen}
          onClick={onToggleFileTree}
        >
          <FileCode className="size-3.5" />
        </PaneIconButton>
        </>
      )}
    />
  );
}

function gitReviewBaseLabel(mode: GitPanelMode): string {
  if (mode === "branch") {
    return "Branch";
  }
  if (mode === "staged") {
    return "Staged";
  }
  return "Unstaged";
}

function gitReviewComparisonLabel(mode: GitPanelMode, baseRef: string | null): string | null {
  if (mode === "branch") {
    return baseRef ? `Target ${baseRef}` : "Target branch";
  }
  if (mode === "staged") {
    return "Target HEAD";
  }
  return "Target working tree";
}
