import { useMemo, useState } from "react";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { FileDiffCard } from "@/components/ui/content/FileDiffCard";
import { ArrowUpRight } from "@/components/ui/icons";
import { collectTurnFilePatches } from "@/lib/domain/chat/turn-file-patches";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";

interface TurnDiffPanelProps {
  turn: TurnRecord;
  transcript: TranscriptState;
  onOpenFile: (filePath: string) => void;
}

export function TurnDiffPanel({ turn, transcript, onOpenFile }: TurnDiffPanelProps) {
  const filePatches = useMemo(
    () => collectTurnFilePatches(turn, transcript),
    [turn, transcript],
  );
  const hasPatches = filePatches.some((fp) => fp.patches.length > 0);
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
    <div className="mt-2 flex flex-col overflow-hidden rounded-xl bg-foreground/[0.03]">
      <div className="flex items-center px-3 py-2 bg-foreground/[0.03]">
        <span className="text-xs text-muted-foreground">
          {fileCount} file{fileCount !== 1 ? "s" : ""} changed
        </span>
      </div>
      <div className="flex flex-col divide-y divide-border/30">
        {filePatches.map((fp) => {
          const isExpanded = manualToggled.has(fp.path);
          const combinedPatch = fp.patches.join("\n");

          return (
            <FileDiffCard
              key={fp.path}
              filePath={fp.path}
              additions={fp.additions}
              deletions={fp.deletions}
              isExpanded={isExpanded}
              onToggleExpand={() => toggleExpanded(fp.path)}
              actions={
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenFile(fp.path);
                  }}
                  aria-label={`Open ${fp.path}`}
                  className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-sidebar-accent"
                  title="Open file"
                >
                  <ArrowUpRight className="size-3" />
                </button>
              }
            >
              {combinedPatch && (
                <div className="max-h-64 overflow-y-auto">
                  <DiffViewer
                    patch={combinedPatch}
                    filePath={fp.path}
                  />
                </div>
              )}
            </FileDiffCard>
          );
        })}
      </div>
    </div>
  );
}
