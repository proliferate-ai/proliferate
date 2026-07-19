import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown } from "@proliferate/ui/icons";
import { ChatDiffLineWrapContextMenu } from "#product/components/content/ui/diff/ChatDiffLineWrapContextMenu";
import { useTurnCurrentFileDiffs } from "#product/hooks/chat/cache/use-turn-current-file-diffs";
import { CHAT_VISIBLE_FILE_CHANGE_LIMIT } from "#product/lib/domain/workspaces/changes/diff-display-policy";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";
import { TurnDiffFileCard } from "#product/components/workspace/chat/transcript/TurnDiffFileCard";
import { TurnDiffPanelHeader } from "#product/components/workspace/chat/transcript/TurnDiffPanelHeader";
import { TranscriptPatchTurnDiffPanel } from "#product/components/workspace/chat/transcript/TranscriptPatchTurnDiffPanel";

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
    return (
      <TranscriptPatchTurnDiffPanel
        turn={turn}
        transcript={transcript}
        onOpenFile={onOpenFile}
        onOpenReviewPane={onOpenReviewPane}
        onUndoTurnChanges={onUndoTurnChanges}
        undoDisabledReason={undoDisabledReason}
        undoBusy={undoBusy}
      />
    );
  }

  const fileCount = files.length;
  const singleFile = fileCount === 1 ? files[0] : null;
  const visibleFiles = singleFile
    ? []
    : showAllFiles
      ? files
      : files.slice(0, CHAT_VISIBLE_FILE_CHANGE_LIMIT);
  const canToggleVisibleFiles = files.length > CHAT_VISIBLE_FILE_CHANGE_LIMIT;
  const hiddenFileCount = files.length - visibleFiles.length;
  const fileStats = new Map(files.map((file) => {
    const transcriptBadge = findFileBadge(turn, file.path, file.displayPath);
    return [file.key, {
      additions: file.currentDiff?.additions ?? transcriptBadge?.additions ?? 0,
      deletions: file.currentDiff?.deletions ?? transcriptBadge?.deletions ?? 0,
    }];
  }));
  const totalAdditions = [...fileStats.values()]
    .reduce((total, stats) => total + stats.additions, 0);
  const totalDeletions = [...fileStats.values()]
    .reduce((total, stats) => total + stats.deletions, 0);
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
    <TurnDiffPanelHeader
      title={title}
      totalAdditions={totalAdditions}
      totalDeletions={totalDeletions}
      canUndo={canUndo}
      showUndo={showUndo}
      undoDisabledReason={undoDisabledReason}
      onUndoTurnChanges={onUndoTurnChanges}
      onOpenReviewPane={onOpenReviewPane}
    />
  );

  return (
    <div
      className="mb-2 flex max-w-full flex-col overflow-hidden rounded-lg border border-border bg-foreground/[0.0475] text-base text-foreground [--turn-diff-row-padding-x:0.75rem] [--turn-diff-row-padding-y:0.25rem]"
    >
      <ChatDiffLineWrapContextMenu trigger={header} />
      {!singleFile && (
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
              fallbackAdditions={fileStats.get(file.key)?.additions ?? 0}
              fallbackDeletions={fileStats.get(file.key)?.deletions ?? 0}
              isExpanded={expandedPaths.has(file.path)}
              onToggleExpand={() => toggleExpanded(file.path)}
              onOpenFile={() => onOpenFile(file.path)}
            />
          ))}
          {canToggleVisibleFiles && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAllFiles((value) => !value)}
              aria-expanded={showAllFiles}
              className="group/show-files flex h-9 w-full justify-start gap-2 rounded-none bg-transparent px-[var(--turn-diff-row-padding-x)] py-[var(--turn-diff-row-padding-y)] text-left text-chat leading-[var(--text-chat--line-height)] text-foreground hover:bg-list-hover/30"
            >
              {showAllFiles ? "Collapse files" : `Show ${hiddenFileCount} more files`}
              <ChevronDown
                aria-hidden="true"
                className={`icon-paired shrink-0 text-muted-foreground ${showAllFiles ? "rotate-180" : ""}`}
              />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function findFileBadge(turn: TurnRecord, ...paths: string[]) {
  const normalizedPaths = new Set(paths.map(normalizePath));
  return turn.fileBadges.find((badge) => normalizedPaths.has(normalizePath(badge.path)));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function extractBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
