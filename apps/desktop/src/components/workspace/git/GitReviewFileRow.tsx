import { useCallback, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import {
  type AnyHarnessQueryTimingOptions,
  useGitDiffQuery,
  useRevertGitPatchesMutation,
  useStagePatchMutation,
  useUnstagePatchMutation,
} from "@anyharness/sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import type { UnifiedDiffHunkActions } from "@/components/content/ui/diff/UnifiedDiffViewer";
import { FileChangeStats } from "@/components/content/ui/FileChangeStats";
import {
  ArrowUpRight,
  ChevronDown,
  CircleAlert,
  FileIcon,
  RefreshCw,
} from "@proliferate/ui/icons";
import {
  DiffDisplayPolicyPlaceholder,
  formatEmptyDiffState,
  GitReviewInlineEmptyState,
} from "@/components/workspace/git/GitReviewInlineState";
import { FileTreeEntryIcon } from "@/components/workspace/files/file-icons";
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

type OpenFile = (path: string) => Promise<void>;

// The review document renders each file as a flat section on the plain pane
// background — unchanged diff lines carry no tint (the [data-git-review-document]
// rules in design product.css flatten the context surface to match).
const SIDEBAR_DIFF_SURFACE_STYLE = {
  "--codex-diffs-surface-override": "var(--color-background)",
} as CSSProperties;

const REVIEW_HEADER_ACTION_CLASS =
  "size-6 shrink-0 rounded-md border-0 bg-transparent p-0 text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring";

// Header row (min-h-9 + py) height estimate for content-visibility sizing.
const REVIEW_CARD_HEADER_ESTIMATE_PX = 38;

/**
 * Off-screen review cards skip layout/paint via content-visibility:auto —
 * without it every diff row of every file stays painted and long change
 * lists starve the WKWebView compositor (black flashes while scrolling).
 *
 * Full-height layout: diffs render at natural height (no inner 24-line
 * viewport cap), so the intrinsic-size estimate uses the full expected
 * line count (changed lines + ~50% context) rather than the old capped
 * value. This keeps the outer panel scrollbar stable for off-screen cards.
 */
function reviewCardVirtualizationStyle({
  collapsed,
  changedLines,
}: {
  collapsed: boolean;
  changedLines: number;
}): CSSProperties {
  // Estimate total rendered lines: changed lines + ~50% context lines.
  // No cap — diffs render full height in this layout variant.
  const estimatedLines = collapsed
    ? 0
    : Math.ceil(Math.max(changedLines, 1) * 1.5);
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
  showStagedChip = false,
  onToggleCollapsed,
  onDiffFetchSettled,
  openFile,
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
  /** Disambiguates staged-scope rows when the composite view lists a partially staged file twice. */
  showStagedChip?: boolean;
  onToggleCollapsed: () => void;
  onDiffFetchSettled: () => void;
  openFile: OpenFile;
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
  // [data-diff-row-virtualization] rule in design product.css): the diff
  // renders at full height in the outer panel scroll, so without it every
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
        binary={Boolean(diffQuery.data?.binary || currentDiff?.binary)}
        showStagedChip={showStagedChip}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        onOpenFile={() => void openFile(file.path)}
      >
        {!currentDiff ? (
          <GitReviewInlineEmptyState
            icon={<FileIcon className="size-3.5" />}
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
            icon={<RefreshCw className="size-3.5" />}
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
            icon={<CircleAlert className="size-3.5" />}
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
      </GitReviewFileSectionShell>
    </div>
  );
}

/**
 * Flat review-document section: sticky Codex-style header (file icon,
 * front-truncated path with dimmed directory, status chip, always-on +N/−N)
 * over the diff body. Replaces the FileDiffCard card look for the git pane.
 */
function GitReviewFileSectionShell({
  file,
  additions,
  deletions,
  binary,
  showStagedChip,
  collapsed,
  onToggleCollapsed,
  onOpenFile,
  children,
}: {
  file: GitPanelReviewFile;
  additions: number;
  deletions: number;
  binary: boolean;
  showStagedChip: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenFile: () => void;
  children: ReactNode;
}) {
  const name = basenameOf(file.path);
  const dir = file.path.slice(0, file.path.length - name.length);
  const status = file.currentDiff?.status ?? null;
  const statusChip = status === "deleted" || status === "renamed" || status === "copied"
    ? status
    : null;
  const hoverTitle = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;

  return (
    <section
      data-review-file-section=""
      className="bg-[var(--color-background)]"
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget
            && (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            onToggleCollapsed();
          }
        }}
        // Near-opaque color-mix, never backdrop-blur: blur resampling across
        // many sticky headers starves the WKWebView compositor.
        className="sticky top-0 z-10 cursor-pointer select-none bg-[color-mix(in_srgb,var(--color-diff-sidebar-file-header-surface)_97%,transparent)]"
      >
        <div className="group/diff-header @container/diff-header flex min-h-8 items-center gap-2 px-3 py-1 text-chat leading-[var(--text-chat--line-height)] text-sidebar-foreground hover:bg-[var(--color-diff-sidebar-file-header-hover-surface)]">
          {/* The growing flex item is this container; the name span inside is
              content-sized so every row's name is left-anchored beside the
              icon. [direction:rtl] front-truncates overflow so the basename
              (the tail) always stays visible. */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileTreeEntryIcon
              name={name}
              path={file.path}
              kind="file"
              className="size-4 shrink-0"
            />
            <span className="min-w-0 truncate [direction:rtl]" title={hoverTitle}>
              <span className="min-w-0 truncate [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:hidden">
                {name}
              </span>
              <span className="hidden min-w-0 truncate [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:inline">
                <span className="text-sidebar-muted-foreground">{dir}</span>
                <span className="text-sidebar-foreground">{name}</span>
              </span>
            </span>
            {/* Stats trail the title directly (Codex changes-pane layout),
                not right-aligned; only hover actions pin to the edge. */}
            <span className="flex shrink-0 items-center gap-1.5">
              {showStagedChip && <GitReviewHeaderChip label="staged" />}
              {statusChip && <GitReviewHeaderChip label={statusChip} />}
              {binary && additions === 0 && deletions === 0 ? (
                <span className="text-[length:var(--text-ui-sm)] text-sidebar-muted-foreground">
                  binary
                </span>
              ) : (
                <FileChangeStats
                  additions={additions}
                  deletions={deletions}
                  className="leading-none"
                />
              )}
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/diff-header:opacity-100 group-focus-within/diff-header:opacity-100">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Open ${file.path}`}
                title="Open file"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenFile();
                }}
                className={REVIEW_HEADER_ACTION_CLASS}
              >
                <ArrowUpRight className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle file diff"
                aria-expanded={!collapsed}
                data-app-action-review-file-expanded={collapsed ? "false" : "true"}
                data-app-action-review-file-toggle=""
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCollapsed();
                }}
                className={REVIEW_HEADER_ACTION_CLASS}
              >
                <ChevronDown
                  className={`size-3.5 transition-transform duration-200 ${
                    collapsed ? "rotate-0" : "rotate-180"
                  }`}
                />
              </Button>
          </span>
        </div>
      </div>
      {!collapsed && (
        <div className="relative overflow-hidden">
          {children}
        </div>
      )}
    </section>
  );
}

/** Quiet status word (staged / deleted / renamed…) — plain muted text, no pill. */
function GitReviewHeaderChip({ label }: { label: string }) {
  return (
    <span className="text-[length:var(--text-ui-sm)] leading-[var(--text-ui-sm--line-height)] text-sidebar-muted-foreground">
      {label}
    </span>
  );
}

function basenameOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
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
