import type {
  FileChangeContentPart,
  FileChangeOperation,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";

export interface LastTurnTouchedFile {
  key: string;
  path: string;
  oldPath: string | null;
  displayPath: string;
  operation: FileChangeOperation;
  topLevel: boolean;
}

export interface LastTurnTouchedFilesResult {
  turn: TurnRecord | null;
  files: LastTurnTouchedFile[];
}

export function collectLatestCompletedTurnTouchedFiles(
  transcript: TranscriptState | null,
): LastTurnTouchedFilesResult {
  const turn = latestCompletedTurn(transcript);
  if (!turn || !transcript) {
    return { turn: null, files: [] };
  }

  const byPath = new Map<string, LastTurnTouchedFile>();
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
      byPath.set(touched.path, {
        ...touched,
        oldPath: touched.oldPath ?? previous?.oldPath ?? null,
      });
    }
  }

  return {
    turn,
    files: [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function latestCompletedTurn(transcript: TranscriptState | null): TurnRecord | null {
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

function touchedFileFromPart(part: FileChangeContentPart): LastTurnTouchedFile | null {
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
