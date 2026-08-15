import type {
  FileChangeContentPart,
  FileChangeOperation,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { collectTurnFilePatches } from "./turn-file-patches";

export interface LastTurnTouchedFile {
  key: string;
  path: string;
  oldPath: string | null;
  displayPath: string;
  operation: FileChangeOperation;
  topLevel: boolean;
  recordedAdditions: number;
  recordedDeletions: number;
  /** Combined patch recorded in the transcript, for files git can no longer diff. */
  recordedPatch: string | null;
}

export interface LastTurnTouchedFilesResult {
  turn: TurnRecord | null;
  files: LastTurnTouchedFile[];
}

export function collectTurnTouchedFiles(
  turn: TurnRecord,
  transcript: TranscriptState,
): LastTurnTouchedFile[] {
  const byPath = new Map<string, LastTurnTouchedFile>();
  const recordedByPath = new Map(
    collectTurnFilePatches(turn, transcript).map((filePatch) => [filePatch.path, {
      additions: filePatch.additions,
      deletions: filePatch.deletions,
      patch: filePatch.patches.filter((patch) => patch.trim().length > 0).join("\n") || null,
    }]),
  );
  for (const itemId of turn.itemOrder) {
    const item = transcript.itemsById[itemId];
    if (!item || item.kind !== "tool_call" || item.parentToolCallId) {
      continue;
    }
    for (const part of item.contentParts) {
      if (part.type !== "file_change") {
        continue;
      }
      const touched = touchedFileFromPart(part);
      if (!touched || !isVisibleTouchedPath(touched.path)) {
        continue;
      }
      const previous = byPath.get(touched.path);
      const recorded = recordedByPath.get(touched.path);
      byPath.set(touched.path, {
        ...touched,
        oldPath: touched.oldPath ?? previous?.oldPath ?? null,
        recordedAdditions: recorded?.additions ?? 0,
        recordedDeletions: recorded?.deletions ?? 0,
        recordedPatch: recorded?.patch ?? null,
      });
    }
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function collectLatestCompletedTurnTouchedFiles(
  transcript: TranscriptState | null,
): LastTurnTouchedFilesResult {
  const turn = latestCompletedTurn(transcript);
  if (!turn || !transcript) {
    return { turn: null, files: [] };
  }

  return {
    turn,
    files: collectTurnTouchedFiles(turn, transcript),
  };
}

export function latestCompletedTurn(transcript: TranscriptState | null): TurnRecord | null {
  if (!transcript) {
    return null;
  }
  for (let index = transcript.turnOrder.length - 1; index >= 0; index -= 1) {
    const turn = transcript.turnsById[transcript.turnOrder[index]];
    if (turn?.completedAt) {
      return turn;
    }
  }
  return null;
}

function touchedFileFromPart(
  part: FileChangeContentPart,
): Omit<LastTurnTouchedFile, "recordedAdditions" | "recordedDeletions" | "recordedPatch"> | null {
  const path = normalizePath(part.newWorkspacePath ?? part.workspacePath ?? part.newPath ?? part.path);
  if (!path) {
    return null;
  }
  const oldPath = normalizePath(part.workspacePath ?? part.path);
  const displayPath = oldPath && oldPath !== path && part.operation === "move"
    ? `${oldPath} -> ${path}`
    : path;
  return {
    key: `${oldPath ?? ""}:${path}:${part.operation}`,
    path,
    oldPath: oldPath && oldPath !== path ? oldPath : null,
    displayPath,
    operation: part.operation,
    topLevel: true,
  };
}

function normalizePath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  return trimmed ? trimmed : null;
}

function isVisibleTouchedPath(path: string): boolean {
  return path.length > 0 && !path.startsWith(".claude/worktrees/");
}
