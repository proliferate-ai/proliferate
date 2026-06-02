import { useState, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChatDiffLineWrapContextMenu } from "@/components/content/ui/diff/ChatDiffLineWrapContextMenu";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileChangeStats } from "@/components/content/ui/FileChangeStats";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import {
  ArrowRight,
  CircleAlert,
  FileCode,
  FileIcon,
  FilePen,
  RefreshCw,
  Undo,
} from "@proliferate/ui/icons";
import {
  useTurnCurrentFileDiffs,
  useTurnCurrentFilePatch,
} from "@/hooks/chat/cache/use-turn-current-file-diffs";
import { CHAT_VISIBLE_FILE_CHANGE_LIMIT } from "@/lib/domain/workspaces/changes/diff-display-policy";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";
import type { GitPanelReviewFile } from "@/lib/domain/workspaces/changes/git-panel-diff";

const TURN_DIFF_VIEWPORT_CLASS = "max-h-[calc(var(--diffs-line-height)*18)]";

interface TurnDiffPanelProps {
  turn: TurnRecord;
  transcript: TranscriptState;
  workspaceId: string | null;
  onOpenFile: (filePath: string) => void;
  onOpenReviewPane?: () => void;
  onUndoTurnChanges?: () => void;
  undoDisabledReason?: string | null;
  undoBusy?: boolean;
}

export function TurnDiffPanel({
  turn,
  transcript,
  workspaceId,
  onOpenFile,
  onOpenReviewPane,
  onUndoTurnChanges,
  undoDisabledReason,
  undoBusy = false,
}: TurnDiffPanelProps) {
  const currentDiffs = useTurnCurrentFileDiffs({ turn, transcript, workspaceId });
  const files = currentDiffs.files;
  const hasFiles = files.length > 0;
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [showAllFiles, setShowAllFiles] = useState(false);

  if (!hasFiles) {
    return null;
  }

  const fileCount = files.length;
  const visibleFiles = showAllFiles
    ? files
    : files.slice(0, CHAT_VISIBLE_FILE_CHANGE_LIMIT);
  const canToggleVisibleFiles = files.length > CHAT_VISIBLE_FILE_CHANGE_LIMIT;
  const hiddenFileCount = files.length - visibleFiles.length;
  const totalAdditions = files.reduce((total, file) => total + (file.currentDiff?.additions ?? 0), 0);
  const totalDeletions = files.reduce((total, file) => total + (file.currentDiff?.deletions ?? 0), 0);
  const singleFile = fileCount === 1 ? files[0] : null;
  const title = singleFile
    ? `Edited ${extractBasename(singleFile.path)}`
    : `Edited ${fileCount} files`;
  const canUndo = Boolean(onUndoTurnChanges) && !undoDisabledReason && !undoBusy;
  const showUndo = Boolean(onUndoTurnChanges) || Boolean(undoDisabledReason);

  const toggleExpanded = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const header = (
    <div
      data-chat-diff-wrap-context-trigger="turn-header"
      className="group/turn-diff-header relative bg-[var(--color-diff-chat-turn-header-surface)] transition-colors hover:bg-[var(--color-diff-chat-turn-header-hover-surface)]"
    >
      <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-3 px-[var(--turn-diff-row-padding-x)] py-2.5 text-left">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-diff-chat-turn-icon-surface)] text-secondary-foreground">
          <FilePen className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-chat font-medium leading-[var(--text-chat--line-height)] text-foreground">
            {title}
          </span>
          <span className="relative block min-h-4 min-w-0 text-xs leading-4 text-muted-foreground">
            <span
              className={`turn-diff-default-subtitle block truncate transition-opacity duration-200 ${
                onOpenReviewPane
                  ? "group-hover/turn-diff-header:opacity-0 group-focus-within/turn-diff-header:opacity-0"
                  : ""
              }`}
            >
              <FileChangeStats
                additions={totalAdditions}
                deletions={totalDeletions}
                className="text-xs"
              />
            </span>
            {onOpenReviewPane && (
              <span className="turn-diff-hover-subtitle pointer-events-none absolute inset-0 flex min-w-0 items-center gap-1 truncate opacity-0 transition-opacity duration-200 group-hover/turn-diff-header:opacity-100 group-focus-within/turn-diff-header:opacity-100">
                Review changes
                <ArrowRight className="size-3 shrink-0" />
              </span>
            )}
          </span>
        </span>
        <span className="pointer-events-auto flex shrink-0 items-center gap-1">
          {showUndo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canUndo}
              title={undoDisabledReason ?? "Undo last turn changes"}
              onClick={(event) => {
                event.stopPropagation();
                onUndoTurnChanges?.();
              }}
              className="h-8 gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Undo className="size-4" />
              Undo
            </Button>
          )}
          {onOpenReviewPane && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onOpenReviewPane();
              }}
              className="h-8 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Review
            </Button>
          )}
        </span>
      </div>
    </div>
  );

  return (
    <div
      className="mb-2 flex max-w-full flex-col overflow-hidden rounded-lg border border-border bg-[var(--color-diff-panel-surface)] text-base text-foreground shadow-sm [--turn-diff-row-padding-x:0.75rem] [--turn-diff-row-padding-y:0.25rem]"
    >
      <ChatDiffLineWrapContextMenu trigger={header} />
      <div className="flex flex-col border-t border-border [--codex-diffs-header-padding-x:var(--turn-diff-row-padding-x)] [--codex-diffs-header-padding-y:var(--turn-diff-row-padding-y)]">
        {visibleFiles.map((file) => (
          <TurnDiffFileCard
            key={file.key}
            file={file}
            fileCount={fileCount}
            turnId={turn.turnId}
            workspaceId={currentDiffs.activeWorkspaceId}
            baseRef={currentDiffs.baseRef}
            isRuntimeReady={currentDiffs.isRuntimeReady}
            runtimeBlockedReason={currentDiffs.runtimeBlockedReason}
            metadataLoading={currentDiffs.isLoading}
            metadataErrorMessage={currentDiffs.errorMessage}
            isExpanded={expandedPaths.has(file.path)}
            onToggleExpand={() => toggleExpanded(file.path)}
            onOpenFile={() => onOpenFile(file.path)}
            onOpenReviewPane={onOpenReviewPane}
          />
        ))}
        {canToggleVisibleFiles && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAllFiles((value) => !value)}
            className="flex h-9 w-full justify-start rounded-none px-[var(--turn-diff-row-padding-x)] py-[var(--turn-diff-row-padding-y)] text-left text-chat leading-[var(--text-chat--line-height)] text-foreground hover:bg-foreground/5"
          >
            {showAllFiles ? "Show fewer files" : `Show ${hiddenFileCount} more files`}
          </Button>
        )}
      </div>
    </div>
  );
}

function TurnDiffFileCard({
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
}: {
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
}) {
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
    enabled:
      isRuntimeReady
      && isExpanded
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
          icon={<RefreshCw className="size-3.5" />}
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
          icon={<CircleAlert className="size-3.5" />}
          title="Diff unavailable"
          description={metadataErrorMessage}
          onOpenFile={onOpenFile}
        />
      ) : !currentDiff ? (
        <TurnDiffInlineState
          icon={<FileIcon className="size-3.5" />}
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
          icon={<CircleAlert className="size-3.5" />}
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

function extractBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
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
