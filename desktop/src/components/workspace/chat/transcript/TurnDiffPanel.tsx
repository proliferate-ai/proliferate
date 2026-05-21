import { useMemo, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import {
  FileChangesCard,
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
    <FileChangesCard
      fileCount={fileCount}
      className="mt-2"
    >
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
            isExpanded={isExpanded}
            onToggleExpand={() => toggleExpanded(fp.path)}
            onOpenFile={() => onOpenFile(fp.path)}
            onOpenAction={onOpenReviewPane}
            openActionLabel={onOpenReviewPane ? "Open changes review" : undefined}
            openActionTitle={onOpenReviewPane ? "Open changes review" : undefined}
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
          className="h-8 w-full justify-center rounded-none px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {showAllFiles ? "Show less" : `Show ${hiddenFileCount} more`}
        </Button>
      )}
    </FileChangesCard>
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
