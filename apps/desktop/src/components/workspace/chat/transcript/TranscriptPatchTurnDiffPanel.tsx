import { useMemo, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChatDiffLineWrapContextMenu } from "@/components/content/ui/diff/ChatDiffLineWrapContextMenu";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileChangeStats } from "@/components/content/ui/FileChangeStats";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import { FilePen } from "@proliferate/ui/icons";
import { collectTurnFilePatches } from "@proliferate/product-domain/chats/transcript/turn-file-patches";
import {
  CHAT_VISIBLE_FILE_CHANGE_LIMIT,
  resolveDiffDisplayPolicy,
} from "@/lib/domain/workspaces/changes/diff-display-policy";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";

const TURN_DIFF_VIEWPORT_CLASS = "max-h-[calc(var(--diffs-line-height)*18)]";

export function TranscriptPatchTurnDiffPanel({
  turn,
  transcript,
  onOpenFile,
}: {
  turn: TurnRecord;
  transcript: TranscriptState;
  onOpenFile: (filePath: string) => void;
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
  const visibleFiles = showAllFiles
    ? filePatches
    : filePatches.slice(0, CHAT_VISIBLE_FILE_CHANGE_LIMIT);
  const hiddenFileCount = filePatches.length - visibleFiles.length;
  const singleFile = fileCount === 1 ? filePatches[0] : null;
  const title = singleFile
    ? `Edited ${extractBasename(singleFile.path)}`
    : `Edited ${fileCount} files`;
  const totalAdditions = filePatches.reduce((total, fp) => total + fp.additions, 0);
  const totalDeletions = filePatches.reduce((total, fp) => total + fp.deletions, 0);

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
      className="relative bg-[var(--color-diff-chat-turn-header-surface)] transition-colors hover:bg-[var(--color-diff-chat-turn-header-hover-surface)]"
    >
      <div className="relative z-10 flex min-w-0 items-center gap-3 px-[var(--turn-diff-row-padding-x)] py-2.5 text-left">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-diff-chat-turn-icon-surface)] text-secondary-foreground">
          <FilePen className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-chat font-medium leading-[var(--text-chat--line-height)] text-foreground">
            {title}
          </span>
          <span className="block min-h-4 min-w-0 text-xs leading-4 text-muted-foreground">
            <FileChangeStats
              additions={totalAdditions}
              deletions={totalDeletions}
              className="text-xs"
            />
          </span>
        </span>
      </div>
    </div>
  );

  return (
    <div className="mb-2 flex max-w-full flex-col overflow-hidden rounded-lg border border-border bg-[var(--color-diff-panel-surface)] text-base text-foreground shadow-sm [--turn-diff-row-padding-x:0.75rem] [--turn-diff-row-padding-y:0.25rem]">
      <ChatDiffLineWrapContextMenu trigger={header} />
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
            <FileDiffCard
              key={fp.path}
              filePath={fp.path}
              displayLabel={fileCount === 1 ? "Details" : undefined}
              additions={fp.additions}
              deletions={fp.deletions}
              showStats={fileCount !== 1}
              isExpanded={expandedPaths.has(fp.path)}
              onToggleExpand={() => toggleExpanded(fp.path)}
              onOpenFile={() => onOpenFile(fp.path)}
              embedded
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
            </FileDiffCard>
          );
        })}
        {filePatches.length > CHAT_VISIBLE_FILE_CHANGE_LIMIT && (
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
