import type {
  FileChangeContentPart,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";

export interface TurnFilePatch {
  path: string;
  additions: number;
  deletions: number;
  patches: string[];
}

/**
 * Collect file change patches from all tool calls in a completed turn.
 * Aggregates additions/deletions and collects all non-null patches per file path.
 * Uses the same path resolution priority as the SDK's collectFileBadges.
 */
export function collectTurnFilePatches(
  turn: TurnRecord,
  transcript: TranscriptState,
): TurnFilePatch[] {
  const byPath = new Map<string, TurnFilePatch>();

  for (const itemId of turn.itemOrder) {
    const item = transcript.itemsById[itemId];
    if (!item || item.kind !== "tool_call") continue;

    for (const part of item.contentParts) {
      if (part.type !== "file_change") continue;
      const fc = part as FileChangeContentPart;
      const filePath =
        fc.newWorkspacePath ?? fc.workspacePath ?? fc.newPath ?? fc.path;

      const existing = byPath.get(filePath) ?? {
        path: filePath,
        additions: 0,
        deletions: 0,
        patches: [],
      };
      existing.additions += fc.additions ?? 0;
      existing.deletions += fc.deletions ?? 0;
      if (fc.patch) {
        existing.patches.push(fc.patch);
      }
      byPath.set(filePath, existing);
    }
  }

  return [...byPath.values()];
}
