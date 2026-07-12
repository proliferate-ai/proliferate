import type { TranscriptItem, TranscriptState, TurnRecord } from "@anyharness/sdk";

export interface TranscriptTurnRowCacheKey {
  turn: TurnRecord;
  itemRefs: readonly (TranscriptItem | null)[];
  needsLeadingSplit: boolean;
  goalSeqBoundaries: readonly number[];
}

export function createTranscriptTurnRowCacheKey(
  turn: TurnRecord,
  transcript: TranscriptState,
  needsLeadingSplit: boolean,
  goalSeqBoundaries: readonly number[],
): TranscriptTurnRowCacheKey {
  return {
    turn,
    itemRefs: turn.itemOrder.map((itemId) => transcript.itemsById[itemId] ?? null),
    needsLeadingSplit,
    goalSeqBoundaries: [...goalSeqBoundaries],
  };
}

export function isTranscriptTurnRowCacheHit(
  cached: TranscriptTurnRowCacheKey,
  current: TranscriptTurnRowCacheKey,
): boolean {
  return cached.turn === current.turn
    && cached.needsLeadingSplit === current.needsLeadingSplit
    && areEntriesEqual(cached.goalSeqBoundaries, current.goalSeqBoundaries)
    && areEntriesEqual(cached.itemRefs, current.itemRefs);
}

function areEntriesEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry === right[index]);
}
