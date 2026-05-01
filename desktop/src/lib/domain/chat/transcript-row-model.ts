import type {
  PendingPromptEntry,
  TranscriptItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import {
  buildTurnPresentation,
  type TurnPresentation,
} from "@/lib/domain/chat/transcript-presentation";

export const TURN_CONTENT_BLOCK_KEY = "content";

export type TranscriptRow =
  | {
    kind: "turn";
    key: `turn:${string}:block:${string}`;
    turnId: string;
    blockKey: typeof TURN_CONTENT_BLOCK_KEY;
    presentation: TurnPresentation;
  }
  | {
    kind: "pending_prompt";
    key: `pending-prompt:${string}`;
  };

export interface BuildTranscriptRowModelInput {
  activeSessionId: string;
  transcript: TranscriptState;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  latestTurnId: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
}

export interface TranscriptRowModelCache {
  turnRowsById: Map<string, CachedTurnRow>;
}

interface CachedTurnRow {
  turn: TurnRecord;
  itemRefs: readonly (TranscriptItem | null)[];
  row: Extract<TranscriptRow, { kind: "turn" }>;
}

export function createTranscriptRowModelCache(): TranscriptRowModelCache {
  return {
    turnRowsById: new Map(),
  };
}

export function buildTranscriptRowModel({
  activeSessionId,
  transcript,
  visibleOptimisticPrompt,
  latestTurnId,
  latestTurnHasAssistantRenderableContent,
}: BuildTranscriptRowModelInput, cache?: TranscriptRowModelCache): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const seenTurnIds = new Set<string>();

  for (const turnId of transcript.turnOrder) {
    const turn = transcript.turnsById[turnId];
    if (!turn) {
      continue;
    }

    const isLatestTurn = turnId === latestTurnId;
    const isLatestTurnInProgress = isLatestTurn && !turn.completedAt;
    if (
      visibleOptimisticPrompt !== null
      && isLatestTurnInProgress
      && !latestTurnHasAssistantRenderableContent
    ) {
      continue;
    }

    seenTurnIds.add(turnId);
    rows.push(buildTurnRow(turn, transcript, cache));
  }

  if (visibleOptimisticPrompt) {
    rows.push({
      kind: "pending_prompt",
      key: buildPendingPromptRowKey(activeSessionId),
    });
  }

  if (cache) {
    for (const turnId of cache.turnRowsById.keys()) {
      if (!seenTurnIds.has(turnId)) {
        cache.turnRowsById.delete(turnId);
      }
    }
  }

  return rows;
}

export function buildTurnContentRowKey(
  turnId: string,
): `turn:${string}:block:${typeof TURN_CONTENT_BLOCK_KEY}` {
  return `turn:${turnId}:block:${TURN_CONTENT_BLOCK_KEY}`;
}

export function buildPendingPromptRowKey(
  activeSessionId: string,
): `pending-prompt:${string}` {
  return `pending-prompt:${activeSessionId}`;
}

function buildTurnRow(
  turn: TurnRecord,
  transcript: TranscriptState,
  cache?: TranscriptRowModelCache,
): Extract<TranscriptRow, { kind: "turn" }> {
  const itemRefs = collectTurnItemRefs(turn, transcript);
  const cached = cache?.turnRowsById.get(turn.turnId) ?? null;
  if (
    cached
    && cached.turn === turn
    && areItemRefsEqual(cached.itemRefs, itemRefs)
  ) {
    return cached.row;
  }

  const row: Extract<TranscriptRow, { kind: "turn" }> = {
    kind: "turn",
    key: buildTurnContentRowKey(turn.turnId),
    turnId: turn.turnId,
    blockKey: TURN_CONTENT_BLOCK_KEY,
    presentation: buildTurnPresentation(turn, transcript),
  };
  cache?.turnRowsById.set(turn.turnId, {
    turn,
    itemRefs,
    row,
  });
  return row;
}

function collectTurnItemRefs(
  turn: TurnRecord,
  transcript: TranscriptState,
): (TranscriptItem | null)[] {
  return turn.itemOrder.map((itemId) => transcript.itemsById[itemId] ?? null);
}

function areItemRefsEqual(
  left: readonly (TranscriptItem | null)[],
  right: readonly (TranscriptItem | null)[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
