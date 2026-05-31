import { useMemo, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import {
  FileChangeStats,
  FileDiffCard,
} from "@/components/content/ui/FileDiffCard";
import { ArrowRight, FilePen, Undo } from "@proliferate/ui/icons";
import { collectTurnFilePatches } from "@proliferate/product-domain/chats/transcript/turn-file-patches";
import {
  CHAT_VISIBLE_FILE_CHANGE_LIMIT,
  resolveDiffDisplayPolicy,
} from "@/lib/domain/workspaces/changes/diff-display-policy";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";

const TURN_DIFF_VIEWPORT_CLASS = "max-h-[calc(var(--diffs-line-height)*18)]";

interface TurnDiffPanelProps {
  turn: TurnRecord;
  transcript: TranscriptState;
  onOpenFile: (filePath: string) => void;
  onOpenReviewPane?: () => void;
  onUndoTurnChanges?: () => void;
  undoDisabledReason?: string | null;
  undoBusy?: boolean;
}

export function TurnDiffPanel({
  turn,
  transcript,
  onOpenFile,
  onOpenReviewPane,
  onUndoTurnChanges,
  undoDisabledReason,
  undoBusy = false,
}: TurnDiffPanelProps) {
  const filePatches = useMemo(
    () => collectTurnFilePatches(turn, transcript)
      .map((fp) => ({
        ...fp,
        patches: fp.patches.filter((patch) => patch.trim().length > 0),
      }))
      .filter((fp) => fp.patches.length > 0),
    [turn, transcript],
  );
  const hasPatches = filePatches.length > 0;
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [showAllFiles, setShowAllFiles] = useState(false);

  if (!hasPatches) {
    return null;
  }

  const fileCount = filePatches.length;
  const visibleFilePatches = showAllFiles
    ? filePatches
    : filePatches.slice(0, CHAT_VISIBLE_FILE_CHANGE_LIMIT);
  const canToggleVisibleFiles = filePatches.length > CHAT_VISIBLE_FILE_CHANGE_LIMIT;
  const hiddenFileCount = filePatches.length - visibleFilePatches.length;
  const totalAdditions = filePatches.reduce((total, fp) => total + fp.additions, 0);
  const totalDeletions = filePatches.reduce((total, fp) => total + fp.deletions, 0);
  const singleFilePatch = fileCount === 1 ? filePatches[0] : null;
  const title = singleFilePatch
    ? `Edited ${extractBasename(singleFilePatch.path)}`
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

  return (
    <div
      className="mb-2 flex max-w-full flex-col overflow-hidden rounded-lg border border-border bg-[var(--color-diff-panel-surface)] text-base text-foreground shadow-sm [--turn-diff-row-padding-x:0.75rem] [--turn-diff-row-padding-y:0.25rem]"
    >
      <div className="group/turn-diff-header relative focus-within:[&_.turn-diff-default-subtitle]:hidden hover:[&_.turn-diff-default-subtitle]:hidden focus-within:[&_.turn-diff-hover-subtitle]:inline-flex hover:[&_.turn-diff-hover-subtitle]:inline-flex">
        <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-3 px-[var(--turn-diff-row-padding-x)] py-2.5 text-left">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <FilePen className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-chat font-medium leading-[var(--text-chat--line-height)] text-foreground">
              {title}
            </span>
            <span className="turn-diff-default-subtitle truncate text-xs text-muted-foreground">
              <FileChangeStats
                additions={totalAdditions}
                deletions={totalDeletions}
                className="text-xs"
              />
            </span>
            {onOpenReviewPane && (
              <span className="turn-diff-hover-subtitle hidden min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                Review changes
                <ArrowRight className="size-3" />
              </span>
            )}
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
                className="h-7 gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Undo className="size-3.5" />
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
                className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Review
              </Button>
            )}
          </span>
        </div>
      </div>
      <div className="flex flex-col border-t border-border [--codex-diffs-header-padding-x:var(--turn-diff-row-padding-x)] [--codex-diffs-header-padding-y:var(--turn-diff-row-padding-y)]">
        {visibleFilePatches.map((fp) => {
          const isExpanded = expandedPaths.has(fp.path);
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
              isExpanded={isExpanded}
              onToggleExpand={() => toggleExpanded(fp.path)}
              onOpenFile={() => onOpenFile(fp.path)}
              onOpenAction={onOpenReviewPane}
              openActionLabel={onOpenReviewPane ? "Show file in review" : undefined}
              openActionTitle={onOpenReviewPane ? "Show file in review" : undefined}
              embedded
            >
              {combinedPatch && !displayPolicy.canRenderInline ? (
                <DiffDisplayPolicyPlaceholder
                  title={displayPolicy.placeholderTitle}
                  description={displayPolicy.placeholderDescription}
                />
              ) : combinedPatch ? (
                <DiffViewer
                  patch={combinedPatch}
                  filePath={fp.path}
                  contentSearchUnitId={`diff:${turn.turnId}:${fp.path}`}
                  viewportClassName={TURN_DIFF_VIEWPORT_CLASS}
                  variant="chat"
                />
              ) : null}
            </FileDiffCard>
          );
        })}
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
