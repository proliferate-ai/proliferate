import { useMemo, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import {
  FileChangeStats,
  FileDiffCard,
} from "@/components/ui/content/FileDiffCard";
import { collectTurnFilePatches } from "@/lib/domain/chat/transcript/turn-file-patches";
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
}

export function TurnDiffPanel({
  turn,
  transcript,
  onOpenFile,
  onOpenReviewPane,
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
      className="mb-2 flex max-w-full flex-col overflow-hidden rounded-lg border border-border bg-[var(--color-diff-panel-surface)] text-base text-foreground shadow-sm [--turn-diff-header-hover-surface:color-mix(in_oklab,var(--color-diff-panel-surface)_96%,var(--color-background))] [--turn-diff-row-padding-x:0.75rem] [--turn-diff-row-padding-y:0.5rem]"
    >
      <div className="relative">
        {onOpenReviewPane && (
          <button
            type="button"
            aria-label="Open changes review"
            onClick={onOpenReviewPane}
            className="absolute inset-0 cursor-pointer bg-transparent hover:bg-[var(--turn-diff-header-hover-surface)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border focus-visible:ring-inset"
          />
        )}
        <div className="pointer-events-none relative z-10 flex min-w-0 items-center px-[var(--turn-diff-row-padding-x)] py-3 text-left">
          <span className="flex min-w-0 items-end gap-x-2 ">
            <span className="truncate text-chat font-medium leading-[var(--text-chat--line-height)] text-foreground">
              {title}
            </span>
            <span className="truncate pb-[2px] text-xs text-muted-foreground">
              <FileChangeStats
                additions={totalAdditions}
                deletions={totalDeletions}
                className="text-xs"
              />
            </span>
          </span>
        </div>
      </div>
      <div className="flex flex-col border-t border-border [--codex-diffs-header-padding-x:var(--turn-diff-row-padding-x)] [--codex-diffs-header-padding-y:var(--turn-diff-row-padding-y)] [--codex-diffs-surface-override:color-mix(in_oklab,var(--color-diff-panel-surface)_50%,transparent)]">
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
