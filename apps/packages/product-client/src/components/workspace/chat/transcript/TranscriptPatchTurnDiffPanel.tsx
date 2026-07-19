import { useMemo, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown } from "@proliferate/ui/icons";
import { ChatDiffLineWrapContextMenu } from "#product/components/content/ui/diff/ChatDiffLineWrapContextMenu";
import { DiffViewer } from "#product/components/content/ui/DiffViewer";
import { collectTurnFilePatches } from "@proliferate/product-domain/chats/transcript/turn-file-patches";
import {
  CHAT_VISIBLE_FILE_CHANGE_LIMIT,
  resolveDiffDisplayPolicy,
} from "#product/lib/domain/workspaces/changes/diff-display-policy";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";
import { TurnDiffPanelHeader } from "#product/components/workspace/chat/transcript/TurnDiffPanelHeader";
import { TurnDiffFileRow } from "#product/components/workspace/chat/transcript/TurnDiffFileRow";

const TURN_DIFF_VIEWPORT_CLASS = "max-h-[calc(var(--diffs-line-height)*18)]";

export function TranscriptPatchTurnDiffPanel({
  turn,
  transcript,
  onOpenFile,
  onOpenReviewPane,
  onUndoTurnChanges,
  undoDisabledReason,
  undoBusy = false,
}: {
  turn: TurnRecord;
  transcript: TranscriptState;
  onOpenFile: (filePath: string) => void;
  onOpenReviewPane?: () => void;
  onUndoTurnChanges?: () => void;
  undoDisabledReason?: string | null;
  undoBusy?: boolean;
}) {
  const filePatches = useMemo(
    () => collectTurnFilePatches(turn, transcript)
      .map((fp) => ({
        ...fp,
        patches: fp.patches.filter((patch) => patch.trim().length > 0),
      }))
      .filter((fp) => fp.patches.length > 0),
    [turn, transcript],
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [showAllFiles, setShowAllFiles] = useState(false);

  if (filePatches.length === 0) {
    return null;
  }

  const fileCount = filePatches.length;
  const singleFile = fileCount === 1 ? filePatches[0] : null;
  const visibleFiles = singleFile
    ? []
    : showAllFiles
      ? filePatches
      : filePatches.slice(0, CHAT_VISIBLE_FILE_CHANGE_LIMIT);
  const hiddenFileCount = filePatches.length - visibleFiles.length;
  const title = singleFile
    ? `Edited ${extractBasename(singleFile.path)}`
    : `Edited ${fileCount} files`;
  const totalAdditions = filePatches.reduce((total, fp) => total + fp.additions, 0);
  const totalDeletions = filePatches.reduce((total, fp) => total + fp.deletions, 0);
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
    <div className="mb-2 flex max-w-full flex-col overflow-hidden rounded-lg border border-border bg-foreground/[0.0475] text-base text-foreground [--turn-diff-row-padding-x:0.75rem] [--turn-diff-row-padding-y:0.25rem]">
      <ChatDiffLineWrapContextMenu trigger={header} />
      {!singleFile && (
        <div className="flex flex-col border-t border-border [--codex-diffs-header-padding-x:var(--turn-diff-row-padding-x)] [--codex-diffs-header-padding-y:var(--turn-diff-row-padding-y)]">
          {visibleFiles.map((fp) => {
            const combinedPatch = fp.patches.join("\n");
            const displayPolicy = resolveDiffDisplayPolicy({
              path: fp.path,
              additions: fp.additions,
              deletions: fp.deletions,
              patch: combinedPatch,
            });

            return (
              <TurnDiffFileRow
                key={fp.path}
                filePath={fp.path}
                additions={fp.additions}
                deletions={fp.deletions}
                showStats={fileCount !== 1}
                isExpanded={expandedPaths.has(fp.path)}
                onToggleExpand={() => toggleExpanded(fp.path)}
                onOpenFile={() => onOpenFile(fp.path)}
              >
                {!displayPolicy.canRenderInline ? (
                  <DiffDisplayPolicyPlaceholder
                    title={displayPolicy.placeholderTitle}
                    description={displayPolicy.placeholderDescription}
                  />
                ) : (
                  <DiffViewer
                    patch={combinedPatch}
                    filePath={fp.path}
                    contentSearchUnitId={`diff:${turn.turnId}:${fp.path}`}
                    viewportClassName={TURN_DIFF_VIEWPORT_CLASS}
                    variant="chat"
                  />
                )}
              </TurnDiffFileRow>
            );
          })}
          {filePatches.length > CHAT_VISIBLE_FILE_CHANGE_LIMIT && (
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
                className={`size-3.5 shrink-0 text-muted-foreground ${showAllFiles ? "rotate-180" : ""}`}
              />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function extractBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
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
