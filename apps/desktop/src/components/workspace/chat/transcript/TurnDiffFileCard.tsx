import type { ReactNode } from "react";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import { useTurnCurrentFilePatch } from "@/hooks/chat/cache/use-turn-current-file-diffs";
import { useLazyDiffFileLines } from "@/hooks/ui/diff/use-lazy-diff-file-lines";
import type { GitPanelReviewFile } from "@/lib/domain/workspaces/changes/git-panel-diff";
import { CircleAlert, FileCode, FileIcon, RefreshCw } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";

const TURN_DIFF_VIEWPORT_CLASS = "max-h-[calc(var(--diffs-line-height)*18)]";

interface TurnDiffFileCardProps {
  file: GitPanelReviewFile;
  fileCount: number;
  turnId: string;
  workspaceId: string | null;
  baseRef: string | null;
  isRuntimeReady: boolean;
  runtimeBlockedReason: string | null;
  metadataLoading: boolean;
  metadataErrorMessage: string | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenFile: () => void;
  onOpenReviewPane?: () => void;
}

export function TurnDiffFileCard({
  file,
  fileCount,
  turnId,
  workspaceId,
  baseRef,
  isRuntimeReady,
  runtimeBlockedReason,
  metadataLoading,
  metadataErrorMessage,
  isExpanded,
  onToggleExpand,
  onOpenFile,
  onOpenReviewPane,
}: TurnDiffFileCardProps) {
  const {
    currentDiff,
    metadataPolicy,
    diffQuery,
    diffErrorMessage,
    additions,
    deletions,
    patch,
    patchPolicy,
  } = useTurnCurrentFilePatch({
    file,
    workspaceId,
    baseRef,
    enabled: isRuntimeReady && isExpanded,
  });
  // Turn diffs use scope=base_worktree (worktree vs merge-base), so the
  // diff's NEW side is the current worktree file — safe for gap expansion.
  const { fileLines, requestFileLines } = useLazyDiffFileLines({
    workspaceId,
    path: file.path,
    enabled: isRuntimeReady,
  });
  const emptyDiffState = formatEmptyDiffState({
    binary: Boolean(diffQuery.data?.binary || currentDiff?.binary),
    truncated: Boolean(diffQuery.data?.truncated && !patch),
  });

  return (
    <FileDiffCard
      filePath={file.displayPath}
      displayLabel={fileCount === 1 ? "Details" : undefined}
      additions={additions}
      deletions={deletions}
      showStats={fileCount !== 1}
      isExpanded={isExpanded}
      onToggleExpand={onToggleExpand}
      onOpenFile={onOpenFile}
      onOpenAction={onOpenReviewPane}
      openActionLabel={onOpenReviewPane ? "Show file in review" : undefined}
      openActionTitle={onOpenReviewPane ? "Show file in review" : undefined}
      embedded
    >
      {!isRuntimeReady ? (
        <TurnDiffInlineState
          icon={<RefreshCw className="size-4" />}
          title="Diff unavailable"
          description={runtimeBlockedReason ?? "The workspace runtime is not ready."}
        />
      ) : metadataLoading && !currentDiff ? (
        <TurnDiffInlineState
          icon={<RefreshCw className="size-3.5 animate-spin" />}
          title="Loading diff"
          description="Fetching the latest file patch."
        />
      ) : metadataErrorMessage && !currentDiff ? (
        <TurnDiffInlineState
          icon={<CircleAlert className="size-4" />}
          title="Diff unavailable"
          description={metadataErrorMessage}
          onOpenFile={onOpenFile}
        />
      ) : !currentDiff ? (
        <TurnDiffInlineState
          icon={<FileIcon className="size-4" />}
          title="No current diff"
          description="This file was touched, but there are no current changes to review against the selected base."
          onOpenFile={onOpenFile}
        />
      ) : !metadataPolicy?.canFetchInline ? (
        <DiffDisplayPolicyPlaceholder
          title={metadataPolicy?.placeholderTitle ?? "Too large to render inline"}
          description={metadataPolicy?.placeholderDescription ?? "Open the file to inspect this change."}
        />
      ) : diffQuery.isLoading ? (
        <TurnDiffInlineState
          icon={<RefreshCw className="size-3.5 animate-spin" />}
          title="Loading diff"
          description="Fetching the latest file patch."
        />
      ) : diffErrorMessage ? (
        <TurnDiffInlineState
          icon={<CircleAlert className="size-4" />}
          title="Diff unavailable"
          description={diffErrorMessage}
          onOpenFile={onOpenFile}
        />
      ) : patch ? (
        patchPolicy && !patchPolicy.canRenderInline ? (
          <DiffDisplayPolicyPlaceholder
            title={patchPolicy.placeholderTitle}
            description={patchPolicy.placeholderDescription}
          />
        ) : (
          <>
            <DiffViewer
              patch={patch}
              filePath={file.displayPath}
              contentSearchUnitId={`diff:${turnId}:${file.path}`}
              viewportClassName={TURN_DIFF_VIEWPORT_CLASS}
              variant="chat"
              fileLines={fileLines}
              onRequestFileLines={requestFileLines}
            />
            {diffQuery.data?.truncated ? (
              <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                Diff truncated because it is too large
              </p>
            ) : null}
          </>
        )
      ) : emptyDiffState ? (
        <TurnDiffInlineState
          icon={emptyDiffState.icon}
          title={emptyDiffState.title}
          description={emptyDiffState.description}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </FileDiffCard>
  );
}

function TurnDiffInlineState({
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
    <div className="flex items-start gap-2 px-3 py-4 text-xs text-muted-foreground">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="mt-0.5 leading-5">{description}</p>}
        {onOpenFile && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenFile}
            className="mt-2 h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Open file
          </Button>
        )}
      </span>
    </div>
  );
}

function DiffDisplayPolicyPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="px-3 py-4 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-0.5 leading-5">{description}</p>
    </div>
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
