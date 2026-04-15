import { useMemo, useState } from "react";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import {
  FileChangesCard,
  FileDiffCard,
} from "@/components/ui/content/FileDiffCard";
import { collectTurnFilePatches } from "@/lib/domain/chat/turn-file-patches";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";

interface TurnDiffPanelProps {
  turn: TurnRecord;
  transcript: TranscriptState;
  onOpenFile: (filePath: string) => void;
}

export function TurnDiffPanel({ turn, transcript, onOpenFile }: TurnDiffPanelProps) {
  const filePatches = useMemo(
    () => collectTurnFilePatches(turn, transcript).filter((fp) => fp.patches.length > 0),
    [turn, transcript],
  );
  const hasPatches = filePatches.length > 0;
  const [manualToggled, setManualToggled] = useState<Set<string>>(new Set());

  if (!hasPatches) {
    return null;
  }

  const fileCount = filePatches.length;

  const toggleExpanded = (path: string) => {
    setManualToggled((prev) => {
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
    <FileChangesCard fileCount={fileCount} className="mt-2">
      {filePatches.map((fp) => {
        const isExpanded = !manualToggled.has(fp.path);
        const combinedPatch = fp.patches.join("\n");

        return (
          <FileDiffCard
            key={fp.path}
            filePath={fp.path}
            additions={fp.additions}
            deletions={fp.deletions}
            isExpanded={isExpanded}
            onToggleExpand={() => toggleExpanded(fp.path)}
            onOpenFile={() => onOpenFile(fp.path)}
            embedded
          >
            {combinedPatch && (
              <DiffViewer
                patch={combinedPatch}
                filePath={fp.path}
                variant="chat"
              />
            )}
          </FileDiffCard>
        );
      })}
    </FileChangesCard>
  );
}
