import type { GitBranchRef } from "@anyharness/sdk";
import { GitReviewOptionsMenu } from "./GitReviewOptionsMenu";
import { GitReviewBaseSelector } from "./GitReviewBaseSelector";
import { GitReviewTargetSelector } from "./GitReviewTargetSelector";
import { ArrowRight, FileCode, SplitPanel } from "@/components/ui/icons";
import { PaneHeader, PaneIconButton } from "@/components/workspace/pane/PaneHeader";
import type { GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";

interface GitPanelHeaderProps {
  changesFilter: GitPanelMode;
  visibleChangedCount: number;
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
        </>
      )}
      right={(
        <>
          <PaneIconButton
            label={layout === "split" ? "Use unified diff" : "Use split diff"}
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
