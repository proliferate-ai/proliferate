import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChatDiffLineWrapContextMenu } from "@/components/content/ui/diff/ChatDiffLineWrapContextMenu";
import { useTurnCurrentFileDiffs } from "@/hooks/chat/cache/use-turn-current-file-diffs";
import { CHAT_VISIBLE_FILE_CHANGE_LIMIT } from "@/lib/domain/workspaces/changes/diff-display-policy";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";
import { TurnDiffFileCard } from "./TurnDiffFileCard";
import { TurnDiffPanelHeader } from "./TurnDiffPanelHeader";

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

function extractBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
