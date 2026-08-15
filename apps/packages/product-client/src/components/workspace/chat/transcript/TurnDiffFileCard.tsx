import type { ReactNode } from "react";
import { DiffViewer } from "#product/components/content/ui/DiffViewer";
import { useTurnCurrentFilePatch } from "#product/hooks/chat/cache/use-turn-current-file-diffs";
import { useLazyDiffFileLines } from "#product/hooks/ui/diff/use-lazy-diff-file-lines";
import type { GitPanelReviewFile } from "#product/lib/domain/workspaces/changes/git-panel-diff";
import { resolveDiffDisplayPolicy } from "#product/lib/domain/workspaces/changes/diff-display-policy";
import { CircleAlert } from "#product/primitives/icons/status";
import { FileCode, FileIcon } from "#product/primitives/icons/workspace";
import { RefreshCw } from "#product/primitives/icons/platform";
import { Button } from "#product/primitives/Button";
import { TurnDiffFileRow } from "#product/components/workspace/chat/transcript/TurnDiffFileRow";

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
  fallbackAdditions: number;
  fallbackDeletions: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenFile: () => void;
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
  fallbackAdditions,
  fallbackDeletions,
  isExpanded,
  onToggleExpand,
  onOpenFile,
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
  // Transcript-recorded fallback for files git can no longer diff against the
  // base (reverted, or written outside the repo). Gap expansion stays off —
  // the recorded patch's new side may not match the current worktree file.
  const recordedPatch = !currentDiff ? file.touched?.recordedPatch ?? null : null;
  const recordedPolicy = recordedPatch
    ? resolveDiffDisplayPolicy({
        path: file.path,
        additions: file.touched?.recordedAdditions ?? 0,
        deletions: file.touched?.recordedDeletions ?? 0,
        patch: recordedPatch,
      })
    : null;
  const displayAdditions = currentDiff || diffQuery.data ? additions : fallbackAdditions;
  const displayDeletions = currentDiff || diffQuery.data ? deletions : fallbackDeletions;

  return (
    <TurnDiffFileRow
      filePath={file.displayPath}
      additions={displayAdditions}
      deletions={displayDeletions}
      showStats={fileCount !== 1}
      isExpanded={isExpanded}
      onToggleExpand={onToggleExpand}
      onOpenFile={onOpenFile}
    >
      {!isRuntimeReady ? (
        <TurnDiffInlineState
          icon={<RefreshCw className="icon-paired" />}
          title="Diff unavailable"
          description={runtimeBlockedReason ?? "The workspace runtime is not ready."}
        />
      ) : metadataLoading && !currentDiff ? (
        <TurnDiffInlineState
          icon={<RefreshCw className="icon-paired animate-spin" />}
          title="Loading diff"
          description="Fetching the latest file patch."
        />
      ) : metadataErrorMessage && !currentDiff ? (
        <TurnDiffInlineState
          icon={<CircleAlert className="icon-paired" />}
          title="Diff unavailable"
          description={metadataErrorMessage}
          onOpenFile={onOpenFile}
        />
      ) : !currentDiff ? (
        recordedPatch && recordedPolicy ? (
          !recordedPolicy.canRenderInline ? (
            <DiffDisplayPolicyPlaceholder
              title={recordedPolicy.placeholderTitle}
              description={recordedPolicy.placeholderDescription}
            />
          ) : (
            <DiffViewer
              patch={recordedPatch}
              filePath={file.displayPath}
              contentSearchUnitId={`diff:${turnId}:${file.path}`}
              viewportClassName={TURN_DIFF_VIEWPORT_CLASS}
              variant="chat"
            />
          )
        ) : (
          <TurnDiffInlineState
            icon={<FileIcon className="icon-paired" />}
            title="No current diff"
            description="This file was touched, but there are no current changes to review against the selected base."
            onOpenFile={onOpenFile}
          />
        )
      ) : !metadataPolicy?.canFetchInline ? (
        <DiffDisplayPolicyPlaceholder
          title={metadataPolicy?.placeholderTitle ?? "Too large to render inline"}
          description={metadataPolicy?.placeholderDescription ?? "Open the file to inspect this change."}
        />
      ) : diffQuery.isLoading ? (
        <TurnDiffInlineState
          icon={<RefreshCw className="icon-paired animate-spin" />}
          title="Loading diff"
          description="Fetching the latest file patch."
        />
      ) : diffErrorMessage ? (
        <TurnDiffInlineState
          icon={<CircleAlert className="icon-paired" />}
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
              <p className="px-3 py-2 text-center text-chat text-muted-foreground">
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
    </TurnDiffFileRow>
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
    <div className="flex items-start gap-2 px-3 py-4 text-chat text-muted-foreground">
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
            className="mt-2 h-7 rounded-md px-2 text-chat text-muted-foreground hover:bg-muted hover:text-foreground"
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
    <div className="px-3 py-4 text-chat text-muted-foreground">
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
      icon: <FileCode className="icon-paired" />,
    };
  }
  if (truncated) {
    return {
      title: "Diff too large",
      description: "Open the file to inspect the full change.",
      icon: <CircleAlert className="icon-paired" />,
    };
  }
  return null;
}
