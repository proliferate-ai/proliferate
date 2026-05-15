import {
  type AnyHarnessQueryTimingOptions,
  useGitDiffQuery,
} from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { FileDiffCard } from "@/components/ui/content/FileDiffCard";
import { Minus, Plus } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type {
  GitPanelReviewFile,
  GitPanelReviewScope,
} from "@/lib/domain/workspaces/changes/git-panel-diff";

type StagePath = (path: string) => Promise<unknown>;
type OpenFile = (path: string) => Promise<void>;

export function GitReviewFileRow({
  id,
  workspaceId,
  sectionScope,
  file,
  baseRef,
  layout,
  wrapLongLines,
  collapsed,
  isRuntimeReady,
  onToggleCollapsed,
  openFile,
  stagePath,
  unstagePath,
  diffTimingOptions,
  measurementOperationId,
}: {
  id: string;
  workspaceId: string | null;
  sectionScope: GitPanelReviewScope;
  file: GitPanelReviewFile;
  baseRef: string | null;
  layout: "unified" | "split";
  wrapLongLines: boolean;
  collapsed: boolean;
  isRuntimeReady: boolean;
  onToggleCollapsed: () => void;
  openFile: OpenFile;
  stagePath: StagePath;
  unstagePath: StagePath;
  diffTimingOptions?: AnyHarnessQueryTimingOptions;
  measurementOperationId?: MeasurementOperationId | null;
}) {
  const currentDiff = file.currentDiff;
  const isBranchMode = sectionScope === "branch";
  const isLastTurnMode = sectionScope === "last_turn";
  const shouldUnstage = sectionScope === "staged";
  const diffQuery = useGitDiffQuery({
    workspaceId,
    path: file.path,
    scope: isLastTurnMode ? "base_worktree" : sectionScope,
    baseRef: isBranchMode || isLastTurnMode ? baseRef : null,
    oldPath: isBranchMode || isLastTurnMode ? file.oldPath : null,
    enabled: isRuntimeReady && !collapsed && Boolean(currentDiff),
    ...(diffTimingOptions ?? {}),
  });
  const diffErrorMessage = diffQuery.isError ? formatDiffErrorMessage(diffQuery.error) : null;
  const additions = diffQuery.data?.additions ?? currentDiff?.additions ?? 0;
  const deletions = diffQuery.data?.deletions ?? currentDiff?.deletions ?? 0;
  const patch = diffQuery.data?.patch ?? null;
  const emptyDiffMessage = formatEmptyDiffMessage({
    binary: Boolean(diffQuery.data?.binary || currentDiff?.binary),
    truncated: Boolean(diffQuery.data?.truncated && !patch),
  });

  if (
    currentDiff
    && isRuntimeReady
    && !collapsed
    && !patch
    && !diffQuery.isLoading
    && !diffErrorMessage
    && !emptyDiffMessage
  ) {
    return null;
  }

  return (
    <div
      id={id}
      className="[--codex-diffs-surface-override:var(--color-diff-surface)]"
    >
      <FileDiffCard
        filePath={file.displayPath}
        additions={additions}
        deletions={deletions}
        isExpanded={!collapsed}
        onToggleExpand={onToggleCollapsed}
        onOpenFile={() => void openFile(file.path)}
        surface="sidebar"
        actions={!isBranchMode && !isLastTurnMode && (
          <Tooltip content={shouldUnstage ? "Unstage file" : "Stage file"}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={(event) => {
                event.stopPropagation();
                if (shouldUnstage) {
                  void unstagePath(file.path);
                } else {
                  void stagePath(file.path);
                }
              }}
              disabled={!isRuntimeReady}
              aria-label={shouldUnstage ? `Unstage ${file.displayPath}` : `Stage ${file.displayPath}`}
              className={`size-5 rounded-full border-0 bg-transparent p-0 ${
                shouldUnstage
                  ? "text-git-green hover:bg-sidebar-accent"
                  : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
            >
              {shouldUnstage ? (
                <Minus className="size-3" />
              ) : (
                <Plus className="size-3" />
              )}
            </Button>
          </Tooltip>
        )}
      >
        {!currentDiff ? (
          <p className="px-3 py-5 text-center text-xs text-sidebar-muted-foreground">
            No current diff against base
          </p>
        ) : diffQuery.isLoading ? (
          <p className="px-3 py-5 text-center text-xs text-sidebar-muted-foreground">
            Loading diff
          </p>
        ) : diffErrorMessage ? (
          <p className="px-3 py-5 text-center text-xs text-sidebar-muted-foreground">
            Diff unavailable: {diffErrorMessage}
          </p>
        ) : patch ? (
          <>
            <DiffViewer
              patch={patch}
              filePath={file.displayPath}
              wrapLongLines={wrapLongLines}
              layout={layout}
              variant={layout === "unified" ? "chat" : "default"}
              viewportClassName="max-h-[calc(var(--diffs-line-height)*24)]"
              operationId={measurementOperationId ?? null}
              overscrollBehavior="auto"
            />
            {diffQuery.data?.truncated ? (
              <p className="px-3 py-2 text-center text-xs text-sidebar-muted-foreground">
                Diff truncated because it is too large
              </p>
            ) : null}
          </>
        ) : emptyDiffMessage ? (
          <p className="px-3 py-5 text-center text-xs text-sidebar-muted-foreground">
            {emptyDiffMessage}
          </p>
        ) : null}
      </FileDiffCard>
    </div>
  );
}

function formatDiffErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Failed to load diff";
}

function formatEmptyDiffMessage({
  binary,
  truncated,
}: {
  binary: boolean;
  truncated: boolean;
}): string | null {
  if (binary) {
    return "Binary file changed";
  }
  if (truncated) {
    return "Diff unavailable because it is too large";
  }
  return null;
}
