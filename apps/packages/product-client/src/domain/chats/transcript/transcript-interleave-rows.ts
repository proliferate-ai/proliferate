import type { TranscriptState, TurnRecord } from "@anyharness/sdk";
import type { GoalTranscriptEvent } from "../../activity/goal-transcript-events";
import type { BackgroundCompletionReceipt } from "../../activity/background-completion-receipt";
import type { TranscriptRow } from "./transcript-row-model";

/**
 * Row-interleaving helpers for `buildTranscriptRowModel` (split out for
 * PROD-SIZE-1). Two auxiliary row kinds are woven into the turn sequence
 * client-side:
 *   - Goal lifecycle rows (`goal_event`) interleave MID-turn by seq.
 *   - Background completion receipts (`completion_receipt`) anchor to a turn's
 *     END by `anchorTurnId` (bgwork r6 round 2).
 * Both are pure functions over the transcript; the model builder buckets, then
 * splices, the results.
 */

export type GoalEventRow = Extract<TranscriptRow, { kind: "goal_event" }>;
export type CompletionReceiptRow = Extract<TranscriptRow, { kind: "completion_receipt" }>;

export const EMPTY_GOAL_ROWS: readonly GoalEventRow[] = [];

export function buildGoalEventRowKey(eventId: string): `goal-event:${string}` {
  return `goal-event:${eventId}`;
}

export interface GoalEventRowBuckets {
  beforeFirstTurn: GoalEventRow[];
  byTurnId: Map<string, GoalEventRow[]>;
}

/**
 * Buckets goal lifecycle rows against the transcript's turns purely by seq
 * (both the goal event and every item ride the same global per-session
 * sequence space).
 *
 * A turn "hosts" an event when the turn's earliest item `startedSeq` is at
 * or before the event's seq and no later turn's earliest item is too — i.e.
 * the last turn that had already started by that seq. Events earlier than
 * every turn's start (including when there are no turns yet) lead the row
 * list.
 *
 * All goal events for a given turn are collected together; the caller
 * (`interleaveGoalRowsBySeq`) will position them by seq within the turn's
 * item sequence.
 */
export function bucketGoalEventRows(
  goalEvents: readonly GoalTranscriptEvent[],
  transcript: TranscriptState,
): GoalEventRowBuckets {
  const beforeFirstTurn: GoalEventRow[] = [];
  const byTurnId = new Map<string, GoalEventRow[]>();
  if (goalEvents.length === 0) {
    return { beforeFirstTurn, byTurnId };
  }

  const orderedTurnRanges = transcript.turnOrder
    .map((turnId) => ({ turnId, range: turnItemSeqRange(transcript, turnId) }))
    .filter((entry): entry is { turnId: string; range: TurnItemSeqRange } =>
      entry.range !== null
    );

  const sortedEvents = [...goalEvents].sort((left, right) => left.seq - right.seq);
  for (const event of sortedEvents) {
    const row: GoalEventRow = {
      kind: "goal_event",
      key: buildGoalEventRowKey(event.id),
      event,
    };

    let host: { turnId: string; range: TurnItemSeqRange } | null = null;
    for (const candidate of orderedTurnRanges) {
      if (candidate.range.minSeq > event.seq) {
        break;
      }
      host = candidate;
    }

    if (host === null) {
      beforeFirstTurn.push(row);
      continue;
    }

    const bucket = byTurnId.get(host.turnId);
    if (bucket) {
      bucket.push(row);
    } else {
      byTurnId.set(host.turnId, [row]);
    }
  }

  return { beforeFirstTurn, byTurnId };
}

export function buildCompletionReceiptRowKey(
  receiptKey: string,
): `completion-receipt:${string}` {
  return `completion-receipt:${receiptKey}`;
}

export interface CompletionReceiptRowBuckets {
  beforeFirstTurn: CompletionReceiptRow[];
  byTurnId: Map<string, CompletionReceiptRow[]>;
  afterAllTurns: CompletionReceiptRow[];
}

/**
 * Buckets completion receipts against the transcript's turns by each receipt's
 * `anchorTurnId` — the turn that was latest when the completion was folded.
 * Unlike goal events (interleaved mid-turn by seq), receipts render only at a
 * turn's END, so this is a plain by-turn assignment, not a seq scan:
 *   - `anchorTurnId === null` (no turn existed yet) → lead the list.
 *   - anchor turn still loaded → after that turn's rows.
 *   - anchor turn no longer loaded (aged out of history) → after all turns.
 * Receipts keep their arrival order within each bucket.
 */
export function bucketCompletionReceiptRows(
  receipts: readonly BackgroundCompletionReceipt[],
  transcript: TranscriptState,
): CompletionReceiptRowBuckets {
  const beforeFirstTurn: CompletionReceiptRow[] = [];
  const byTurnId = new Map<string, CompletionReceiptRow[]>();
  const afterAllTurns: CompletionReceiptRow[] = [];
  for (const receipt of receipts) {
    const row: CompletionReceiptRow = {
      kind: "completion_receipt",
      key: buildCompletionReceiptRowKey(receipt.key),
      receipt,
    };
    if (receipt.anchorTurnId === null) {
      beforeFirstTurn.push(row);
    } else if (transcript.turnsById[receipt.anchorTurnId]) {
      const bucket = byTurnId.get(receipt.anchorTurnId);
      if (bucket) {
        bucket.push(row);
      } else {
        byTurnId.set(receipt.anchorTurnId, [row]);
      }
    } else {
      afterAllTurns.push(row);
    }
  }
  return { beforeFirstTurn, byTurnId, afterAllTurns };
}

interface TurnItemSeqRange {
  minSeq: number;
  maxSeq: number;
}

function turnItemSeqRange(transcript: TranscriptState, turnId: string): TurnItemSeqRange | null {
  const turn = transcript.turnsById[turnId];
  if (!turn) {
    return null;
  }
  let minSeq: number | null = null;
  let maxSeq: number | null = null;
  for (const itemId of turn.itemOrder) {
    const item = transcript.itemsById[itemId];
    if (!item) {
      continue;
    }
    if (minSeq === null || item.startedSeq < minSeq) {
      minSeq = item.startedSeq;
    }
    if (maxSeq === null || item.startedSeq > maxSeq) {
      maxSeq = item.startedSeq;
    }
  }
  return minSeq === null || maxSeq === null ? null : { minSeq, maxSeq };
}

/**
 * Interleaves goal event rows by seq among a turn's rows, positioning each
 * goal event at its true chronological location within the turn's content.
 *
 * Strategy:
 * - Collect all items from all turn rows with their seq values.
 * - For each goal event, find its insertion point: after the last item whose
 *   startedSeq < event.seq, which determines which turn row it should follow.
 * - Special case: if the turn has a leading user-message row split, goal
 *   events whose seq falls before all assistant content still render after
 *   the user message row (preserving the "goal set right after user prompt" UX).
 */
export function interleaveGoalRowsBySeq(
  turnRows: readonly Extract<TranscriptRow, { kind: "turn" }>[],
  goalRows: readonly GoalEventRow[],
  _turn: TurnRecord,
  transcript: TranscriptState,
): TranscriptRow[] {
  if (goalRows.length === 0) {
    return [...turnRows];
  }

  // Build a list of all items across all rows, tracking which row each item belongs to.
  interface ItemEntry {
    seq: number;
    rowIndex: number;
  }
  const items: ItemEntry[] = [];

  for (let rowIndex = 0; rowIndex < turnRows.length; rowIndex += 1) {
    const turnRow = turnRows[rowIndex];
    for (const block of turnRow.renderPresentation.displayBlocks) {
      if (block.kind === "item") {
        const item = transcript.itemsById[block.itemId];
        if (item) {
          items.push({ seq: item.startedSeq, rowIndex });
        }
      } else if (
        block.kind === "collapsed_actions"
        || block.kind === "inline_tools"
        || block.kind === "subagent_creations"
      ) {
        for (const itemId of block.itemIds) {
          const item = transcript.itemsById[itemId];
          if (item) {
            items.push({ seq: item.startedSeq, rowIndex });
          }
        }
      }
    }
  }

  // Sort items by seq to enable binary-search-like positioning.
  items.sort((a, b) => a.seq - b.seq);

  // Determine if the first row is a leading user-message split.
  const hasLeadingSplit = turnRows.length > 1 && turnRows[0].isFirstTurnRow && !turnRows[0].isLastTurnRow;

  // Sort goal rows by seq to maintain order.
  const sortedGoalRows = [...goalRows].sort((a, b) => a.event.seq - b.event.seq);

  // For each goal event, determine which row it should be inserted after.
  // A goal at seq N should appear:
  // - AFTER the row containing the last item with seq < N, AND
  // - BEFORE the row containing the first item with seq >= N
  // This ensures goals render at their chronological position, even if that
  // position is mid-way through a row's content (the row will have been split
  // to enable this).
  const goalInsertionPoints = new Map<number, GoalEventRow[]>(); // rowIndex -> goals to insert after

  for (const goalRow of sortedGoalRows) {
    const goalSeq = goalRow.event.seq;

    // Find the row containing the last item with seq < goalSeq.
    // If the next item (seq >= goalSeq) is in a DIFFERENT row, insert after
    // the current row. Otherwise, the goal falls mid-row, and the row should
    // have been split — but if not, we insert before that row.
    let lastItemBefore: ItemEntry | null = null;
    let firstItemAtOrAfter: ItemEntry | null = null;

    for (const item of items) {
      if (item.seq < goalSeq) {
        lastItemBefore = item;
      } else if (item.seq >= goalSeq && firstItemAtOrAfter === null) {
        firstItemAtOrAfter = item;
        break;
      }
    }

    let targetRowIndex: number;
    if (lastItemBefore === null) {
      // Goal precedes all items. Insert after the leading split row if it
      // exists, otherwise before all rows.
      targetRowIndex = hasLeadingSplit ? 0 : -1;
    } else if (firstItemAtOrAfter === null) {
      // Goal follows all items. Insert after the row containing the last item.
      targetRowIndex = lastItemBefore.rowIndex;
    } else if (lastItemBefore.rowIndex !== firstItemAtOrAfter.rowIndex) {
      // Goal falls between two different rows. This is the clean case: insert
      // after lastItemBefore's row, which places it before firstItemAtOrAfter's row.
      targetRowIndex = lastItemBefore.rowIndex;
    } else {
      // Goal falls mid-row: the row contains both the last item <= goalSeq
      // and the first item > goalSeq. Insert the goal AFTER this row, since
      // we can't split it finer than the user/content boundary.
      targetRowIndex = lastItemBefore.rowIndex;
    }

    const existing = goalInsertionPoints.get(targetRowIndex);
    if (existing) {
      existing.push(goalRow);
    } else {
      goalInsertionPoints.set(targetRowIndex, [goalRow]);
    }
  }

  // Assemble the result by interleaving turn rows with goal rows.
  const result: TranscriptRow[] = [];

  // Insert any goals that should come before all rows.
  const beforeAllGoals = goalInsertionPoints.get(-1);
  if (beforeAllGoals) {
    result.push(...beforeAllGoals);
  }

  for (let rowIndex = 0; rowIndex < turnRows.length; rowIndex += 1) {
    result.push(turnRows[rowIndex]);

    // Insert any goals that should come after this row.
    const afterThisRowGoals = goalInsertionPoints.get(rowIndex);
    if (afterThisRowGoals) {
      result.push(...afterThisRowGoals);
    }
  }

  return result;
}
