import type {
  FileChangeContentPart,
  FileChangeOperation,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";

export interface TurnFilePatch {
  path: string;
  additions: number;
  deletions: number;
  patches: string[];
}

export interface TurnFileRevertPatchEntry {
  path: string;
  oldPath: string | null;
  operation: FileChangeOperation;
  patch: string;
  patchTruncated?: boolean | null;
}

export interface TurnFileRevertPatchEntriesResult {
  entries: TurnFileRevertPatchEntry[];
  blockedReason: string | null;
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
    if (!item || item.kind !== "tool_call" || item.parentToolCallId) continue;

    for (const part of item.contentParts) {
      if (part.type !== "file_change") continue;
      const fc = part as FileChangeContentPart;
      const filePath = normalizeVisibleFilePath(
        fc.newWorkspacePath ?? fc.workspacePath ?? fc.newPath ?? fc.path,
      );
      if (!filePath) continue;

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

export function collectTurnFileRevertPatchEntries(
  turn: TurnRecord,
  transcript: TranscriptState,
): TurnFileRevertPatchEntriesResult {
  const entries: TurnFileRevertPatchEntry[] = [];
  let blockedReason: string | null = null;

  for (let itemIndex = turn.itemOrder.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = transcript.itemsById[turn.itemOrder[itemIndex]];
    if (!item || item.kind !== "tool_call" || item.parentToolCallId) continue;

    for (let partIndex = item.contentParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = item.contentParts[partIndex];
      if (part.type !== "file_change") continue;
      const fc = part as FileChangeContentPart;
      const path = normalizeFilePath(fc.newWorkspacePath ?? fc.workspacePath ?? fc.newPath ?? fc.path);
      if (!path) {
        blockedReason ??= "Undo is unavailable because one file change has no workspace path.";
        continue;
      }
      if (!isVisibleFilePath(path)) {
        continue;
      }
      const patch = fc.patch?.trimEnd();
      if (!patch) {
        blockedReason ??= "Undo is unavailable because one file change did not include a patch.";
        continue;
      }
      if (fc.patchTruncated) {
        blockedReason ??= "Undo is unavailable because one file patch was truncated.";
        continue;
      }
      const oldPath = normalizeFilePath(fc.workspacePath ?? fc.path);
      entries.push({
        path,
        oldPath: oldPath && oldPath !== path ? oldPath : null,
        operation: fc.operation,
        patch,
        patchTruncated: fc.patchTruncated,
      });
    }
  }

  return {
    entries,
    blockedReason,
  };
}

function normalizeFilePath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  return trimmed ? trimmed : null;
}

function normalizeVisibleFilePath(path: string | null | undefined): string | null {
  const normalized = normalizeFilePath(path);
  if (!normalized || !isVisibleFilePath(normalized)) {
    return null;
  }
  return normalized;
}

function isVisibleFilePath(path: string): boolean {
  return !path.startsWith(".claude/worktrees/");
}
