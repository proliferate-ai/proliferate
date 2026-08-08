import type { TranscriptItem, TranscriptState, TurnRecord } from "@anyharness/sdk";

export interface TranscriptTurnRowCacheKey {
  turn: TurnRecord;
  itemRefs: readonly (TranscriptItem | null)[];
  needsLeadingSplit: boolean;
  goalSeqBoundaries: readonly number[];
  /**
   * Whether this turn hosts the workspace-creation receipt (baked into one
   * of its rows via `hostsWorkspaceReceipt`). Part of the cache key so a row
   * built before the receipt resolved (or after it stopped applying) can't
   * be served stale once the flag flips.
   */
  hostsWorkspaceReceipt: boolean;
}

export function createTranscriptTurnRowCacheKey(
  turn: TurnRecord,
  transcript: TranscriptState,
  needsLeadingSplit: boolean,
  goalSeqBoundaries: readonly number[],
  hostsWorkspaceReceipt: boolean,
): TranscriptTurnRowCacheKey {
  return {
    turn,
    itemRefs: turn.itemOrder.map((itemId) => transcript.itemsById[itemId] ?? null),
    needsLeadingSplit,
    goalSeqBoundaries: [...goalSeqBoundaries],
    hostsWorkspaceReceipt,
  };
}

export function isTranscriptTurnRowCacheHit(
  cached: TranscriptTurnRowCacheKey,
  current: TranscriptTurnRowCacheKey,
): boolean {
  return cached.turn === current.turn
    && cached.needsLeadingSplit === current.needsLeadingSplit
    && cached.hostsWorkspaceReceipt === current.hostsWorkspaceReceipt
    && areEntriesEqual(cached.goalSeqBoundaries, current.goalSeqBoundaries)
    && areEntriesEqual(cached.itemRefs, current.itemRefs);
}

function areEntriesEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry === right[index]);
}
