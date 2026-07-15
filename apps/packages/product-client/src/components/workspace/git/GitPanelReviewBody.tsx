import type { AnyHarnessQueryTimingOptions } from "@anyharness/sdk-react";
import { SkeletonBlock, shimmerDelay } from "#product/components/feedback/Skeleton";
import {
  GitLastTurnUndoAction,
  GitReviewDiffPolicyNotice,
  GitReviewNoChangesState,
} from "#product/components/workspace/git/GitPanelReviewChrome";
import { GitPanelReviewSections } from "#product/components/workspace/git/GitPanelReviewSections";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import type { DiffDisplayPolicySummary } from "#product/lib/domain/workspaces/changes/diff-display-policy";
import type {
  GitPanelMode,
  GitPanelSection,
} from "#product/lib/domain/workspaces/changes/git-panel-diff";

interface GitPanelReviewBodyProps {
  changesFilter: GitPanelMode;
  baseRef: string | null;
  isLoading: boolean;
  errorMessage: string | null;
  runtimeBlockedReason: string | null;
  hasReviewEntries: boolean;
  lastTurnPatchFileCount: number;
  lastTurnUndoDisabledReason: string | null;
  lastTurnUndoBusy: boolean;
  diffPolicySummary: DiffDisplayPolicySummary;
  sections: readonly GitPanelSection[];
  activeWorkspaceId: string | null;
  layout: "unified" | "split";
  wrapLongLines: boolean;
  collapsedFiles: ReadonlySet<string>;
  isRuntimeReady: boolean;
  permittedDiffFetchKeys: ReadonlySet<string>;
  openFile: (path: string) => Promise<void>;
  onRefresh: () => void;
  onUndoLastTurn: () => void;
  onToggleFileCollapsed: (key: string) => void;
  onDiffFetchSettled: (key: string) => void;
  diffTimingOptions?: AnyHarnessQueryTimingOptions;
  measurementOperationId?: MeasurementOperationId | null;
}

export function GitPanelReviewBody({
  changesFilter,
  baseRef,
  isLoading,
  errorMessage,
  runtimeBlockedReason,
  hasReviewEntries,
  lastTurnPatchFileCount,
  lastTurnUndoDisabledReason,
  lastTurnUndoBusy,
  diffPolicySummary,
  sections,
  activeWorkspaceId,
  layout,
  wrapLongLines,
  collapsedFiles,
  isRuntimeReady,
  permittedDiffFetchKeys,
  openFile,
  onRefresh,
  onUndoLastTurn,
  onToggleFileCollapsed,
  onDiffFetchSettled,
  diffTimingOptions,
  measurementOperationId,
}: GitPanelReviewBodyProps) {
  return (
    <div
      id="review-diffs-collapsed"
      data-app-action-review-scroll=""
      data-thread-find-target="review"
      data-git-review-document=""
      className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pb-3"
    >
      <div className="relative flex min-h-full flex-col">
        <span
          aria-hidden="true"
          data-app-action-review-metrics-probe=""
          className="pointer-events-none absolute left-0 top-0 size-px opacity-0"
        />
        {isLoading && (
          <div className="space-y-2 px-4 py-4" role="status" aria-label="Loading changes">
            <SkeletonBlock className="h-3 w-32 bg-sidebar-accent" style={shimmerDelay(0)} />
            <SkeletonBlock className="h-3 w-48 bg-sidebar-accent" style={shimmerDelay(1)} />
            <SkeletonBlock className="h-3 w-40 bg-sidebar-accent" style={shimmerDelay(2)} />
          </div>
        )}
        {errorMessage && (
          <p className="px-4 py-4 text-xs text-destructive">{errorMessage}</p>
        )}
        {!errorMessage && runtimeBlockedReason && (
          <p className="px-4 py-4 text-xs text-sidebar-muted-foreground">
            {runtimeBlockedReason}
          </p>
        )}
        {!isLoading && !errorMessage && !runtimeBlockedReason && !hasReviewEntries && (
          <div className="px-2 pt-2">
            <GitReviewNoChangesState
              mode={changesFilter}
              baseRef={baseRef}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {!isLoading && !errorMessage && !runtimeBlockedReason && hasReviewEntries && (
          <div className="flex flex-col gap-0.5">
            {(changesFilter === "last_turn" || diffPolicySummary.total > 0) && (
              <div className="flex flex-col gap-1.5 px-2 pt-2">
                {changesFilter === "last_turn" && (
                  <GitLastTurnUndoAction
                    fileCount={lastTurnPatchFileCount}
                    disabledReason={lastTurnUndoDisabledReason}
                    busy={lastTurnUndoBusy}
                    onUndo={onUndoLastTurn}
                  />
                )}
                {diffPolicySummary.total > 0 && (
                  <GitReviewDiffPolicyNotice summary={diffPolicySummary} />
                )}
              </div>
            )}
            <GitPanelReviewSections
              changesFilter={changesFilter}
              sections={sections}
              activeWorkspaceId={activeWorkspaceId}
              baseRef={baseRef}
              layout={layout}
              wrapLongLines={wrapLongLines}
              collapsedFiles={collapsedFiles}
              isRuntimeReady={isRuntimeReady}
              permittedDiffFetchKeys={permittedDiffFetchKeys}
              openFile={openFile}
              onToggleFileCollapsed={onToggleFileCollapsed}
              onDiffFetchSettled={onDiffFetchSettled}
              diffTimingOptions={diffTimingOptions}
              measurementOperationId={measurementOperationId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
