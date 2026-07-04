import { useCallback, useEffect, useMemo, type CSSProperties } from "react";
import {
  type AnyHarnessQueryTimingOptions,
  useGitDiffQuery,
  useRevertGitPatchesMutation,
  useStagePatchMutation,
  useUnstagePatchMutation,
} from "@anyharness/sdk-react";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import type { UnifiedDiffHunkActions } from "@/components/content/ui/diff/UnifiedDiffViewer";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import {
  CircleAlert,
  FileIcon,
  RefreshCw,
} from "@proliferate/ui/icons";
import {
  DiffDisplayPolicyPlaceholder,
  formatEmptyDiffState,
  GitReviewInlineEmptyState,
} from "@/components/workspace/git/GitReviewInlineState";
import { GitReviewStageAction } from "@/components/workspace/git/GitReviewStageAction";
import { GitReviewStatusBadge } from "@/components/workspace/git/GitReviewStatusBadge";
import { useLazyDiffFileLines } from "@/hooks/ui/diff/use-lazy-diff-file-lines";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { extractHunkPatch, isHunkActionEligible } from "@/lib/domain/files/hunk-patch";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  DIFF_ROW_VIRTUALIZATION_LINE_THRESHOLD,
  resolveDiffDisplayPolicy,
} from "@/lib/domain/workspaces/changes/diff-display-policy";
import type {
  GitPanelReviewFile,
  GitPanelReviewScope,
} from "@/lib/domain/workspaces/changes/git-panel-diff";

type StagePath = (path: string) => Promise<unknown>;
type OpenFile = (path: string) => Promise<void>;

const SIDEBAR_DIFF_SURFACE_STYLE = {
  "--codex-diffs-surface-override": "var(--color-diff-surface)",
} as CSSProperties;

// Header row (min-h-9 + py) plus the diff viewer's 24-line viewport cap
// (GitReviewFileRow passes max-h of --diffs-line-height * 24 to DiffViewer).
const REVIEW_CARD_HEADER_ESTIMATE_PX = 38;
const REVIEW_CARD_MAX_VISIBLE_LINES = 24;

/**
 * Off-screen review cards skip layout/paint via content-visibility:auto —
 * without it every diff row of every file stays painted and long change
 * lists starve the WKWebView compositor (black flashes while scrolling).
 * The intrinsic-size estimate keeps the scrollbar stable: header height
 * plus the expected visible diff lines (changed lines ~+50% context,
 * capped by the viewer's 24-line viewport) in --diffs-line-height units.
 */
function reviewCardVirtualizationStyle({
  collapsed,
  changedLines,
}: {
  collapsed: boolean;
  changedLines: number;
}): CSSProperties {
  const estimatedLines = collapsed
    ? 0
    : Math.min(
        Math.ceil(Math.max(changedLines, 1) * 1.5),
        REVIEW_CARD_MAX_VISIBLE_LINES,
      );
  return {
    contentVisibility: "auto",
    containIntrinsicSize: `auto calc(${REVIEW_CARD_HEADER_ESTIMATE_PX}px + var(--diffs-line-height) * ${estimatedLines})`,
  } as CSSProperties;
}

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
  fetchDiff,
  onToggleCollapsed,
  onDiffFetchSettled,
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
  fetchDiff: boolean;
  onToggleCollapsed: () => void;
  onDiffFetchSettled: () => void;
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

  // Hunk-level mutation hooks (lightweight — share the same query client)
  const revertMutation = useRevertGitPatchesMutation({ workspaceId });
  const stagePatchMutation = useStagePatchMutation({ workspaceId });
  const unstagePatchMutation = useUnstagePatchMutation({ workspaceId });
  const showToast = useToastStore((state) => state.show);
  const hunkMutationInFlight =
    revertMutation.isPending || stagePatchMutation.isPending || unstagePatchMutation.isPending;
  // Gap expansion reads the worktree file, which only matches the diff's
  // NEW side for worktree-target scopes: `unstaged` (worktree vs index) and
  // `last_turn`/`base_worktree` (worktree vs merge-base). `staged` diffs
  // target the index and `branch` diffs target HEAD, so those degrade to
  // informational separators.
  const gapExpansionScopeValid = sectionScope === "unstaged" || isLastTurnMode;
  const { fileLines, requestFileLines } = useLazyDiffFileLines({
    workspaceId,
    path: file.path,
    enabled: gapExpansionScopeValid && isRuntimeReady,
  });
  const metadataPolicy = useMemo(
    () => currentDiff
      ? resolveDiffDisplayPolicy({
          path: currentDiff.path,
          additions: currentDiff.additions,
          deletions: currentDiff.deletions,
        })
      : null,
    [currentDiff],
  );
  const diffQuery = useGitDiffQuery({
    workspaceId,
    path: file.path,
    scope: isLastTurnMode ? "base_worktree" : sectionScope,
    baseRef: isBranchMode || isLastTurnMode ? baseRef : null,
    oldPath: isBranchMode || isLastTurnMode ? file.oldPath : null,
    enabled:
      isRuntimeReady
      && !collapsed
      && fetchDiff
      && Boolean(currentDiff)
      && Boolean(metadataPolicy?.canFetchInline),
    ...(diffTimingOptions ?? {}),
  });
  const diffErrorMessage = diffQuery.isError ? formatDiffErrorMessage(diffQuery.error) : null;
  const additions = diffQuery.data?.additions ?? currentDiff?.additions ?? 0;
  const deletions = diffQuery.data?.deletions ?? currentDiff?.deletions ?? 0;
  const patch = diffQuery.data?.patch ?? null;
  const patchPolicy = useMemo(
    () => patch
      ? resolveDiffDisplayPolicy({
          path: file.path,
          additions,
          deletions,
          patch,
        })
      : metadataPolicy,
    [additions, deletions, file.path, metadataPolicy, patch],
  );
  const waitingForDiffPermit = Boolean(
    currentDiff
    && isRuntimeReady
    && metadataPolicy?.canFetchInline
    && !fetchDiff
    && !patch
    && !diffQuery.data
    && !diffQuery.isError,
  );
  // Opt large diffs into per-row content-visibility virtualization (the
  // [data-diff-row-virtualization] rule in design desktop.css): the diff
  // scrolls inside this card's 24-line max-h viewport, so without it every
  // row of a multi-thousand-line patch stays painted while scrolling.
  const virtualizeDiffRows = Boolean(
    patchPolicy
    && patchPolicy.patchLineCount > DIFF_ROW_VIRTUALIZATION_LINE_THRESHOLD,
  );
  const emptyDiffState = formatEmptyDiffState({
    binary: Boolean(diffQuery.data?.binary || currentDiff?.binary),
    truncated: Boolean(diffQuery.data?.truncated && !patch),
  });

  // Hunk-level actions: only for working-tree scopes (unstaged/staged) in
  // unified layout, and only when the patch is complete and the file is not
  // binary/rename/copy. Branch and last-turn diffs are excluded — their hunks
  // are not guaranteed to apply against the current worktree/index.
  const hunkActionsEnabled = Boolean(
    patch
    && !isBranchMode
    && !isLastTurnMode
    && layout === "unified"
    && !diffQuery.data?.truncated
    && isHunkActionEligible(patch, file.oldPath)
    && isRuntimeReady,
  );

  const handleHunkRevert = useCallback(
    (hunkIndex: number) => {
      if (!patch) return;
      const result = extractHunkPatch({ patch, hunkIndex, filePath: file.path, oldPath: file.oldPath });
      if (result) {
        revertMutation
          .mutateAsync({
            entries: [{
              path: file.path,
              operation: "edit",
              patch: result.patch,
            }],
          })
          .catch((error: unknown) => {
            showToast(formatHunkActionError(error, "Could not revert this change."));
          });
      }
    },
    [patch, file.path, file.oldPath, revertMutation, showToast],
  );

  const handleHunkStageOrUnstage = useCallback(
    (hunkIndex: number) => {
      if (!patch) return;
      const result = extractHunkPatch({ patch, hunkIndex, filePath: file.path, oldPath: file.oldPath });
      if (!result) return;
      if (shouldUnstage) {
        unstagePatchMutation.mutateAsync(result.patch).catch((error: unknown) => {
          showToast(formatHunkActionError(error, "Could not unstage this change."));
        });
      } else {
        stagePatchMutation.mutateAsync(result.patch).catch((error: unknown) => {
          showToast(formatHunkActionError(error, "Could not stage this change."));
        });
      }
    },
    [patch, file.path, file.oldPath, shouldUnstage, stagePatchMutation, unstagePatchMutation, showToast],
  );

  const hunkActions: UnifiedDiffHunkActions | null = hunkActionsEnabled
    ? {
        mode: shouldUnstage ? "staged" : "unstaged",
        disabled: !isRuntimeReady || hunkMutationInFlight,
        onRevert: handleHunkRevert,
        onStageOrUnstage: handleHunkStageOrUnstage,
      }
    : null;

  useEffect(() => {
    if (diffQuery.data || diffQuery.isError) {
      onDiffFetchSettled();
    }
  }, [diffQuery.data, diffQuery.isError, onDiffFetchSettled]);

  if (
    currentDiff
    && isRuntimeReady
    && !collapsed
    && fetchDiff
    && metadataPolicy?.canFetchInline
    && !patch
    && !diffQuery.isLoading
    && !diffErrorMessage
    && !emptyDiffState
  ) {
    return null;
  }

  return (
    <div
      id={id}
      data-review-path={file.path}
      data-diff-row-virtualization={virtualizeDiffRows ? "" : undefined}
      className="scroll-mt-2"
      style={{
        ...SIDEBAR_DIFF_SURFACE_STYLE,
        ...reviewCardVirtualizationStyle({
          collapsed,
          changedLines: additions + deletions,
        }),
      }}
    >
      <FileDiffCard
        filePath={file.displayPath}
        additions={additions}
        deletions={deletions}
        metadata={currentDiff && additions === 0 && deletions === 0 ? (
          <GitReviewStatusBadge status={currentDiff.status} />
        ) : null}
        isExpanded={!collapsed}
        onToggleExpand={onToggleCollapsed}
        onOpenFile={() => void openFile(file.path)}
        surface="sidebar"
        actions={!isBranchMode && !isLastTurnMode && (
          <GitReviewStageAction
            displayPath={file.displayPath}
            path={file.path}
            shouldUnstage={shouldUnstage}
            disabled={!isRuntimeReady}
            stagePath={stagePath}
            unstagePath={unstagePath}
          />
        )}
      >
        {!currentDiff ? (
          <GitReviewInlineEmptyState
            icon={<FileIcon className="size-4" />}
            title="No current diff"
            description="This file was touched, but there are no current changes to review against the selected base."
            onOpenFile={() => void openFile(file.path)}
          />
        ) : !metadataPolicy?.canFetchInline ? (
          <DiffDisplayPolicyPlaceholder
            title={metadataPolicy?.placeholderTitle ?? "Too large to render inline"}
            description={metadataPolicy?.placeholderDescription ?? "Open the file to inspect this change."}
            onOpenFile={() => void openFile(file.path)}
          />
        ) : waitingForDiffPermit ? (
          <GitReviewInlineEmptyState
            icon={<RefreshCw className="size-4" />}
            title="Waiting to load diff"
            description="This file will load when review capacity is available."
          />
        ) : diffQuery.isLoading ? (
          <GitReviewInlineEmptyState
            icon={<RefreshCw className="size-3.5 animate-spin" />}
            title="Loading diff"
            description="Fetching the latest file patch."
          />
        ) : diffErrorMessage ? (
          <GitReviewInlineEmptyState
            icon={<CircleAlert className="size-4" />}
            title="Diff unavailable"
            description={diffErrorMessage}
            onOpenFile={() => void openFile(file.path)}
          />
        ) : patch ? (
          patchPolicy && !patchPolicy.canRenderInline ? (
            <DiffDisplayPolicyPlaceholder
              title={patchPolicy.placeholderTitle}
              description={patchPolicy.placeholderDescription}
              onOpenFile={() => void openFile(file.path)}
            />
          ) : (
            <>
              <DiffViewer
                patch={patch}
                filePath={file.displayPath}
                wrapLongLines={wrapLongLines}
                layout={layout}
                variant={layout === "unified" ? "chat" : "default"}
                viewportClassName="max-h-[calc(var(--diffs-line-height)*24)]"
                operationId={measurementOperationId ?? null}
                overscrollBehaviorX="none"
                overscrollBehaviorY="none"
                chainVerticalWheel
                fileLines={fileLines}
                onRequestFileLines={requestFileLines}
                hunkActions={hunkActions}
              />
              {diffQuery.data?.truncated ? (
                <p className="px-3 py-2 text-center text-xs text-sidebar-muted-foreground">
                  Diff truncated because it is too large
                </p>
              ) : null}
            </>
          )
        ) : emptyDiffState ? (
          <GitReviewInlineEmptyState
            icon={emptyDiffState.icon}
            title={emptyDiffState.title}
            description={emptyDiffState.description}
            onOpenFile={() => void openFile(file.path)}
          />
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

function formatHunkActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
