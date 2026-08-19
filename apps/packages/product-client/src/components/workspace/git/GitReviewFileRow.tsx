import { useEffect, useMemo } from "react";
import {
  type AnyHarnessQueryTimingOptions,
  useGitDiffQuery,
} from "@anyharness/sdk-react";
import { DiffViewer } from "#product/components/content/ui/DiffViewer";
import { CircleAlert } from "#product/primitives/icons/status";
import { FileIcon } from "#product/primitives/icons/workspace";
import { RefreshCw } from "#product/primitives/icons/platform";
import {
  DiffDisplayPolicyPlaceholder,
  formatEmptyDiffState,
  GitReviewInlineEmptyState,
} from "#product/components/workspace/git/GitReviewInlineState";
import { GitReviewFileSectionShell } from "#product/components/workspace/git/GitReviewFileSectionShell";
import { useLazyDiffFileLines } from "#product/hooks/ui/diff/use-lazy-diff-file-lines";
import { useGitReviewHunkActions } from "#product/hooks/workspaces/workflows/files/use-git-review-hunk-actions";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import {
  DIFF_ROW_VIRTUALIZATION_LINE_THRESHOLD,
  resolveDiffDisplayPolicy,
} from "#product/lib/domain/workspaces/changes/diff-display-policy";
import { resolveGitPanelReviewEvidence } from "#product/lib/domain/workspaces/changes/git-panel-review-model";
import {
  reviewCardVirtualizationStyle,
  SIDEBAR_DIFF_SURFACE_STYLE,
} from "#product/lib/domain/workspaces/changes/git-review-file-row-layout";
import type {
  GitPanelReviewFile,
  GitPanelReviewScope,
} from "#product/lib/domain/workspaces/changes/git-panel-diff";

type OpenFile = (path: string) => Promise<void>;

export function GitReviewFileRow({
  id,
  workspaceId,
  sectionScope,
  file,
  baseRef,
  cacheGeneration,
  metadataPending,
  layout,
  wrapLongLines,
  collapsed,
  isRuntimeReady,
  fetchDiff,
  showStagedChip = false,
  onToggleCollapsed,
  onDiffFetchSettled,
  openFile,
  diffTimingOptions,
  measurementOperationId,
  contentSearchOrderKey,
}: {
  id: string;
  workspaceId: string | null;
  sectionScope: GitPanelReviewScope;
  file: GitPanelReviewFile;
  baseRef: string | null;
  cacheGeneration: string;
  metadataPending: boolean;
  layout: "unified" | "split";
  wrapLongLines: boolean;
  collapsed: boolean;
  isRuntimeReady: boolean;
  fetchDiff: boolean;
  /** Disambiguates staged-scope rows when the composite view lists a partially staged file twice. */
  showStagedChip?: boolean;
  onToggleCollapsed: () => void;
  onDiffFetchSettled: () => void;
  openFile: OpenFile;
  diffTimingOptions?: AnyHarnessQueryTimingOptions;
  measurementOperationId?: MeasurementOperationId | null;
  contentSearchOrderKey: number;
}) {
  const currentDiff = file.currentDiff;
  const isBranchMode = sectionScope === "branch";
  const isLastTurnMode = sectionScope === "last_turn";
  // Gap expansion reads the worktree file, which only matches the diff's
  // NEW side for worktree-target scopes: `unstaged` (worktree vs index) and
  // `last_turn`/`base_worktree` (worktree vs merge-base). `staged` diffs
  // target the index and `branch` diffs target HEAD, so those degrade to
  // informational separators.
  const gapExpansionScopeValid = sectionScope === "unstaged" || isLastTurnMode;
  const { fileLines, requestFileLines } = useLazyDiffFileLines({
    workspaceId,
    path: file.path,
    enabled: gapExpansionScopeValid && Boolean(currentDiff) && isRuntimeReady,
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
    cacheGeneration,
    enabled:
      isRuntimeReady
      && !metadataPending
      && !collapsed
      && fetchDiff
      && Boolean(currentDiff)
      && Boolean(metadataPolicy?.canFetchInline),
    ...(diffTimingOptions ?? {}),
  });
  const currentDiffData = currentDiff
    && !metadataPending
    && !diffQuery.isFetching
    && !diffQuery.isStale
      ? diffQuery.data ?? null
      : null;
  const diffEvidencePending = metadataPending
    || diffQuery.isLoading
    || diffQuery.isFetching
    || Boolean(!diffQuery.isError && diffQuery.isStale && diffQuery.data);
  const evidence = resolveGitPanelReviewEvidence(file, currentDiffData);
  const diffErrorMessage = currentDiff
    && !metadataPending
    && !diffQuery.isFetching
    && diffQuery.isError
    ? formatDiffErrorMessage(diffQuery.error)
    : null;
  const { additions, deletions } = evidence;
  const patch = evidence.source === "current" ? evidence.patch : null;
  const recordedPatch = evidence.source === "recorded" ? evidence.patch : null;
  const recordedPolicy = useMemo(
    () => recordedPatch
      ? resolveDiffDisplayPolicy({
          path: file.path,
          additions,
          deletions,
          patch: recordedPatch,
        })
      : null,
    [additions, deletions, file.path, recordedPatch],
  );
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
    && !currentDiffData
    && !diffErrorMessage,
  );
  // Opt large diffs into per-row content-visibility virtualization (the
  // [data-diff-row-virtualization] rule in design product.css): the diff
  // renders at full height in the outer panel scroll, so without it every
  // row of a multi-thousand-line patch stays painted while scrolling.
  const renderedPatchPolicy = patchPolicy ?? recordedPolicy;
  const virtualizeDiffRows = Boolean(
    renderedPatchPolicy
    && renderedPatchPolicy.patchLineCount > DIFF_ROW_VIRTUALIZATION_LINE_THRESHOLD,
  );
  const emptyDiffState = formatEmptyDiffState({
    binary: evidence.binary,
    truncated: evidence.truncated && !patch,
  });

  const hunkActions = useGitReviewHunkActions({
    workspaceId,
    sectionScope,
    file,
    layout,
    patch,
    truncated: evidence.truncated,
    isRuntimeReady,
  });

  useEffect(() => {
    if (
      currentDiff
      && !metadataPending
      && !diffQuery.isFetching
      && (diffQuery.isError || (!diffQuery.isStale && diffQuery.data))
    ) {
      onDiffFetchSettled();
    }
  }, [
    currentDiff,
    diffQuery.data,
    diffQuery.isError,
    diffQuery.isFetching,
    diffQuery.isStale,
    metadataPending,
    onDiffFetchSettled,
  ]);

  if (
    currentDiff
    && isRuntimeReady
    && !collapsed
    && fetchDiff
    && metadataPolicy?.canFetchInline
    && !patch
    && !diffEvidencePending
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
      className="scroll-mt-0"
      style={{
        ...SIDEBAR_DIFF_SURFACE_STYLE,
        ...reviewCardVirtualizationStyle({
          collapsed,
          changedLines: additions + deletions,
        }),
      }}
    >
      <GitReviewFileSectionShell
        file={file}
        additions={additions}
        deletions={deletions}
        binary={evidence.binary}
        showStagedChip={showStagedChip}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        onOpenFile={() => void openFile(file.path)}
      >
        {!currentDiff ? (
          recordedPatch && recordedPolicy ? (
            !recordedPolicy.canRenderInline ? (
              <DiffDisplayPolicyPlaceholder
                title={recordedPolicy.placeholderTitle}
                description={recordedPolicy.placeholderDescription}
                onOpenFile={() => void openFile(file.path)}
              />
            ) : (
              <DiffViewer
                patch={recordedPatch}
                filePath={file.displayPath}
                wrapLongLines={wrapLongLines}
                layout={layout}
                variant={layout === "unified" ? "chat" : "default"}
                contentSearchUnitId={`review-diff:${id}`}
                contentSearchSurface="review"
                contentSearchOrderKey={contentSearchOrderKey}
                overscrollBehaviorX="none"
                overscrollBehaviorY="none"
              />
            )
          ) : (
            <GitReviewInlineEmptyState
              icon={<FileIcon className="icon-paired" />}
              title="No current diff"
              description="This file was touched, but there are no current changes to review against the selected base."
              onOpenFile={() => void openFile(file.path)}
            />
          )
        ) : !metadataPolicy?.canFetchInline ? (
          <DiffDisplayPolicyPlaceholder
            title={metadataPolicy?.placeholderTitle ?? "Too large to render inline"}
            description={metadataPolicy?.placeholderDescription ?? "Open the file to inspect this change."}
            onOpenFile={() => void openFile(file.path)}
          />
        ) : waitingForDiffPermit ? (
          <GitReviewInlineEmptyState
            icon={<RefreshCw className="icon-paired" />}
            title="Waiting to load diff"
            description="This file will load when review capacity is available."
          />
        ) : diffEvidencePending ? (
          <GitReviewInlineEmptyState
            icon={<RefreshCw className="icon-paired animate-spin" />}
            title="Loading diff"
            description="Fetching the latest file patch."
          />
        ) : diffErrorMessage ? (
          <GitReviewInlineEmptyState
            icon={<CircleAlert className="icon-paired" />}
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
                operationId={measurementOperationId ?? null}
                contentSearchUnitId={`review-diff:${id}`}
                contentSearchSurface="review"
                contentSearchOrderKey={contentSearchOrderKey}
                overscrollBehaviorX="none"
                overscrollBehaviorY="none"
                fileLines={fileLines}
                onRequestFileLines={requestFileLines}
                hunkActions={hunkActions}
              />
              {evidence.truncated ? (
                <p className="px-3 py-2 text-center text-ui-sm text-sidebar-muted-foreground">
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
      </GitReviewFileSectionShell>
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
