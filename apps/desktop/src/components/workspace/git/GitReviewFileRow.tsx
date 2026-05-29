import { useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import {
  type AnyHarnessQueryTimingOptions,
  useGitDiffQuery,
} from "@anyharness/sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import {
  CircleAlert,
  FileCode,
  FileIcon,
  Minus,
  Plus,
  RefreshCw,
} from "@proliferate/ui/icons";
import {
  GitReviewEmptyState,
  GitReviewEmptyStateAction,
} from "./GitReviewEmptyState";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { resolveDiffDisplayPolicy } from "@/lib/domain/workspaces/changes/diff-display-policy";
import type {
  GitPanelFile,
  GitPanelReviewFile,
  GitPanelReviewScope,
} from "@/lib/domain/workspaces/changes/git-panel-diff";

type StagePath = (path: string) => Promise<unknown>;
type OpenFile = (path: string) => Promise<void>;

const SIDEBAR_DIFF_SURFACE_STYLE = {
  "--codex-diffs-surface-override": "var(--color-diff-surface)",
} as CSSProperties;

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
  const emptyDiffState = formatEmptyDiffState({
    binary: Boolean(diffQuery.data?.binary || currentDiff?.binary),
    truncated: Boolean(diffQuery.data?.truncated && !patch),
  });

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
      style={SIDEBAR_DIFF_SURFACE_STYLE}
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
              className={`size-6 rounded-full border-0 bg-transparent p-0 ${
                shouldUnstage
                  ? "text-git-green hover:bg-sidebar-accent"
                  : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
            >
              {shouldUnstage ? (
                <Minus className="size-3.5" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
          </Tooltip>
        )}
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
                viewportClassName="max-h-[calc(var(--diffs-line-height)*24)]"
                operationId={measurementOperationId ?? null}
                overscrollBehaviorX="none"
                overscrollBehaviorY="none"
                chainVerticalWheel
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

function GitReviewStatusBadge({ status }: { status: GitPanelFile["status"] }) {
  const meta = fileStatusMeta(status);
  return (
    <span
      className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-medium leading-none ${meta.className}`}
      title={meta.title}
      aria-label={meta.title}
    >
      {meta.label}
    </span>
  );
}

function fileStatusMeta(status: GitPanelFile["status"]): {
  label: string;
  title: string;
  className: string;
} {
  switch (status) {
    case "added":
    case "untracked":
      return {
        label: "A",
        title: "Added",
        className: "bg-git-green/10 text-git-green",
      };
    case "deleted":
      return {
        label: "D",
        title: "Deleted",
        className: "bg-git-red/10 text-git-red",
      };
    case "renamed":
      return {
        label: "R",
        title: "Renamed",
        className: "bg-sidebar-accent text-sidebar-foreground",
      };
    case "copied":
      return {
        label: "C",
        title: "Copied",
        className: "bg-sidebar-accent text-sidebar-foreground",
      };
    case "conflicted":
      return {
        label: "!",
        title: "Conflicted",
        className: "bg-destructive/10 text-destructive",
      };
    case "modified":
    default:
      return {
        label: "M",
        title: "Modified",
        className: "bg-sidebar-accent text-sidebar-muted-foreground",
      };
  }
}

function DiffDisplayPolicyPlaceholder({
  title,
  description,
  onOpenFile,
}: {
  title: string;
  description: string;
  onOpenFile: () => void;
}) {
  return (
    <GitReviewInlineEmptyState
      icon={<CircleAlert className="size-3.5" />}
      title={title}
      description={description}
      onOpenFile={onOpenFile}
    />
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

function GitReviewInlineEmptyState({
  icon,
  title,
  description,
  onOpenFile,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  onOpenFile?: () => void;
}) {
  return (
    <GitReviewEmptyState
      variant="inline"
      icon={icon}
      title={title}
      description={description}
      action={onOpenFile ? (
        <GitReviewEmptyStateAction onClick={onOpenFile}>
          Open file
        </GitReviewEmptyStateAction>
      ) : null}
    />
  );
}

function formatEmptyDiffState({
  binary,
  truncated,
}: {
  binary: boolean;
  truncated: boolean;
}): {
  title: string;
  description: string;
  icon: ReactNode;
} | null {
  if (binary) {
    return {
      title: "Binary file changed",
      description: "Open the file to inspect this change.",
      icon: <FileCode className="size-3.5" />,
    };
  }
  if (truncated) {
    return {
      title: "Diff too large",
      description: "Open the file to inspect the full change.",
      icon: <CircleAlert className="size-3.5" />,
    };
  }
  return null;
}
