import type {
  PendingPromptEntry,
  TranscriptItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import {
  buildTurnPresentation,
  type TurnDisplayBlock,
  type TurnPresentation,
} from "./transcript-presentation";
import { turnHasRenderableTranscriptContent } from "../pending-prompts/pending-prompts";
import type { PromptOutboxEntry } from "../../sessions/intents/session-intent-model";
import type { GoalTranscriptEvent } from "../../activity/goal-transcript-events";

export const TURN_CONTENT_BLOCK_KEY = "content";
export const TURN_COMPLETED_HISTORY_BLOCK_KEY = "completed-history";

const SPLIT_TURN_MIN_ITEM_COUNT = 24;

export type TranscriptRow =
  | {
    kind: "turn";
    key: `turn:${string}:block:${string}`;
    turnId: string;
    blockKey: string;
    presentation: TurnPresentation;
    renderPresentation: TurnPresentation;
    isFirstTurnRow: boolean;
    isLastTurnRow: boolean;
  }
  | {
    kind: "pending_prompt";
    key: `pending-prompt:${string}`;
  }
  | {
    kind: "outbox_prompt";
    key: `prompt:${string}`;
    clientPromptId: string;
  }
  | {
    kind: "goal_event";
    key: `goal-event:${string}`;
    event: GoalTranscriptEvent;
  };

export interface BuildTranscriptRowModelInput {
  activeSessionId: string;
  transcript: TranscriptState;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  visibleOutboxEntries?: readonly PromptOutboxEntry[];
  latestTurnId: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
  /**
   * Goal lifecycle rows composed client-side from the raw session event
   * stream (the runtime keeps goal chunks out of stored transcript
   * content — see `deriveGoalTranscriptEvents`). Positioned purely by
   * `event.seq` against each turn's item `startedSeq` range (both ride the
   * same global per-session sequence space) — not by the event's `turnId`,
   * which is informational only and not required to be set.
   *
   * Anchoring model (see `bucketGoalEventRows` for the implementation):
   *   - Goal events are interleaved BY SEQ within their host turn's item
   *     sequence, rendering at their true chronological position among the
   *     turn's content. A goal event renders after the most-recent item
   *     whose startedSeq < the event's seq, and before the next item whose
   *     startedSeq >= the event's seq.
   *   - Events with no host turn (session start, or a goal set before any
   *     turn ever ran) lead the row list.
   *   - Events whose seq falls after all of their host turn's items render
   *     at the turn's END (between turns, chronologically idle).
   *
   * The row assembly is a single forward pass over `transcript.turnOrder`
   * that interleaves each turn's goal rows inline with that turn's own
   * rows by seq — this makes strict monotonicity a structural property,
   * not something bucketing has to get right after the fact: a turn N+1
   * row can never be pushed before a row anchored to turn N or earlier.
   */
  goalEvents?: readonly GoalTranscriptEvent[];
}

export interface TranscriptRowModelCache {
  turnRowsById: Map<string, CachedTurnRow>;
}

interface CachedTurnRow {
  turn: TurnRecord;
  itemRefs: readonly (TranscriptItem | null)[];
  needsLeadingSplit: boolean;
  rows: readonly Extract<TranscriptRow, { kind: "turn" }>[];
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
  visibleOutboxEntries = [],
  latestTurnId,
  latestTurnHasAssistantRenderableContent,
  goalEvents = EMPTY_GOAL_EVENTS,
}: BuildTranscriptRowModelInput, cache?: TranscriptRowModelCache): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const seenTurnIds = new Set<string>();
  const goalRows = bucketGoalEventRows(goalEvents, transcript);

  rows.push(...goalRows.beforeFirstTurn);

  for (const turnId of transcript.turnOrder) {
    const turn = transcript.turnsById[turnId];
    if (!turn) {
      continue;
    }

    const isLatestTurn = turnId === latestTurnId;
    const isLatestTurnInProgress = isLatestTurn && !turn.completedAt;
    const hasVisibleLocalPrompt =
      visibleOptimisticPrompt !== null || visibleOutboxEntries.length > 0;
    if (
      hasVisibleLocalPrompt
      && isLatestTurnInProgress
      && !latestTurnHasAssistantRenderableContent
      && !turnHasRenderableTranscriptContent(turn, transcript)
    ) {
      continue;
    }

    seenTurnIds.add(turnId);
    const turnGoalRows = goalRows.byTurnId.get(turnId) ?? EMPTY_GOAL_ROWS;
    const needsLeadingSplit = turnGoalRows.length > 0;
    const { rows: turnRows } = buildTurnRows(
      turn,
      transcript,
      cache,
      needsLeadingSplit,
    );
    // Interleave goal rows by seq among the turn's own rows.
    const interleavedRows = interleaveGoalRowsBySeq(
      turnRows,
      turnGoalRows,
      turn,
      transcript,
    );
    rows.push(...interleavedRows);
  }

  if (visibleOptimisticPrompt) {
    rows.push({
      kind: "pending_prompt",
      key: buildPendingPromptRowKey(activeSessionId),
    });
  }

  for (const entry of visibleOutboxEntries) {
    rows.push({
      kind: "outbox_prompt",
      key: buildOutboxPromptRowKey(entry.clientPromptId),
      clientPromptId: entry.clientPromptId,
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

const EMPTY_GOAL_EVENTS: readonly GoalTranscriptEvent[] = [];
const EMPTY_GOAL_ROWS: readonly GoalEventRow[] = [];

type GoalEventRow = Extract<TranscriptRow, { kind: "goal_event" }>;

export function buildGoalEventRowKey(eventId: string): `goal-event:${string}` {
  return `goal-event:${eventId}`;
}

interface GoalEventRowBuckets {
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
function bucketGoalEventRows(
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
function interleaveGoalRowsBySeq(
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

export function buildTurnContentRowKey(
  turnId: string,
): `turn:${string}:block:${typeof TURN_CONTENT_BLOCK_KEY}` {
  return `turn:${turnId}:block:${TURN_CONTENT_BLOCK_KEY}`;
}

function buildTurnBlockRowKey(
  turnId: string,
  blockKey: string,
): `turn:${string}:block:${string}` {
  return `turn:${turnId}:block:${blockKey}`;
}

export function buildPendingPromptRowKey(
  activeSessionId: string,
): `pending-prompt:${string}` {
  return `pending-prompt:${activeSessionId}`;
}

export function buildOutboxPromptRowKey(
  clientPromptId: string,
): `prompt:${string}` {
  return `prompt:${clientPromptId}`;
}

interface TurnRowsResult {
  rows: readonly Extract<TranscriptRow, { kind: "turn" }>[];
}

function buildTurnRows(
  turn: TurnRecord,
  transcript: TranscriptState,
  cache: TranscriptRowModelCache | undefined,
  needsLeadingSplit: boolean,
): TurnRowsResult {
  const itemRefs = collectTurnItemRefs(turn, transcript);
  const cached = cache?.turnRowsById.get(turn.turnId) ?? null;
  if (
    cached
    && cached.turn === turn
    && cached.needsLeadingSplit === needsLeadingSplit
    && areItemRefsEqual(cached.itemRefs, itemRefs)
  ) {
    return { rows: cached.rows };
  }

  const presentation = buildTurnPresentation(turn, transcript);
  const rows = buildRowsForTurnPresentation(
    turn,
    transcript,
    presentation,
    needsLeadingSplit,
  );
  cache?.turnRowsById.set(turn.turnId, {
    turn,
    itemRefs,
    needsLeadingSplit,
    rows,
  });
  return { rows };
}

function buildRowsForTurnPresentation(
  turn: TurnRecord,
  transcript: TranscriptState,
  presentation: TurnPresentation,
  needsLeadingSplit: boolean,
): readonly Extract<TranscriptRow, { kind: "turn" }>[] {
  const chunks = shouldSplitTurnIntoRows(turn, presentation)
    ? chunkTurnDisplayBlocks(presentation)
    : [];
  if (chunks.length > 1) {
    return chunks.map((chunk, index) => {
      const renderPresentation: TurnPresentation = {
        ...presentation,
        displayBlocks: chunk.blocks,
      };
      return buildTurnRow({
        turnId: turn.turnId,
        blockKey: chunk.blockKey,
        presentation,
        renderPresentation,
        isFirstTurnRow: index === 0,
        isLastTurnRow: index === chunks.length - 1,
      });
    });
  }

  // Single-row turn: check if we should split out a leading user-message row
  // to enable proper goal-event interleaving (only when there are goal events).
  if (needsLeadingSplit) {
    const leadingCount = countLeadingUserMessageBlocks(presentation, transcript);
    if (leadingCount > 0 && leadingCount < presentation.displayBlocks.length) {
      const leadingBlocks = presentation.displayBlocks.slice(0, leadingCount);
      const restBlocks = presentation.displayBlocks.slice(leadingCount);
      const leadingRow = buildTurnRow({
        turnId: turn.turnId,
        blockKey: getTurnDisplayBlockKey(presentation.displayBlocks[0]),
        presentation,
        renderPresentation: { ...presentation, displayBlocks: leadingBlocks },
        isFirstTurnRow: true,
        isLastTurnRow: false,
      });
      const restRow = buildTurnRow({
        turnId: turn.turnId,
        blockKey: TURN_CONTENT_BLOCK_KEY,
        presentation,
        renderPresentation: { ...presentation, displayBlocks: restBlocks },
        isFirstTurnRow: false,
        isLastTurnRow: true,
      });
      return [leadingRow, restRow];
    }
  }

  return [buildTurnRow({
    turnId: turn.turnId,
    blockKey: TURN_CONTENT_BLOCK_KEY,
    presentation,
    renderPresentation: presentation,
    isFirstTurnRow: true,
    isLastTurnRow: true,
  })];
}

/** Counts the turn's leading run of display blocks that are `user_message`
 * items — usually exactly 1 (a turn starts with the user's prompt). Used to
 * carve a dedicated "user message" row out of an otherwise-unsplit turn so
 * a start-anchored goal row can render between it and the turn's assistant
 * content. */
function countLeadingUserMessageBlocks(
  presentation: TurnPresentation,
  transcript: TranscriptState,
): number {
  let count = 0;
  for (const block of presentation.displayBlocks) {
    if (block.kind !== "item") {
      break;
    }
    if (transcript.itemsById[block.itemId]?.kind !== "user_message") {
      break;
    }
    count += 1;
  }
  return count;
}

function buildTurnRow(input: {
  turnId: string;
  blockKey: string;
  presentation: TurnPresentation;
  renderPresentation: TurnPresentation;
  isFirstTurnRow: boolean;
  isLastTurnRow: boolean;
}): Extract<TranscriptRow, { kind: "turn" }> {
  return {
    kind: "turn",
    key: input.blockKey === TURN_CONTENT_BLOCK_KEY
      ? buildTurnContentRowKey(input.turnId)
      : buildTurnBlockRowKey(input.turnId, input.blockKey),
    turnId: input.turnId,
    blockKey: input.blockKey,
    presentation: input.presentation,
    renderPresentation: input.renderPresentation,
    isFirstTurnRow: input.isFirstTurnRow,
    isLastTurnRow: input.isLastTurnRow,
  };
}

function shouldSplitTurnIntoRows(
  turn: TurnRecord,
  presentation: TurnPresentation,
): boolean {
  return !!turn.completedAt
    && turn.itemOrder.length >= SPLIT_TURN_MIN_ITEM_COUNT
    && presentation.displayBlocks.length > 1;
}

interface TurnDisplayBlockChunk {
  blockKey: string;
  blocks: TurnDisplayBlock[];
}

function chunkTurnDisplayBlocks(
  presentation: TurnPresentation,
): TurnDisplayBlockChunk[] {
  const completedHistoryRootIds = new Set(presentation.completedHistoryRootIds);
  const chunks: TurnDisplayBlockChunk[] = [];
  let completedHistoryBlocks: TurnDisplayBlock[] = [];

  const flushCompletedHistory = () => {
    if (completedHistoryBlocks.length === 0) {
      return;
    }
    chunks.push({
      blockKey: TURN_COMPLETED_HISTORY_BLOCK_KEY,
      blocks: completedHistoryBlocks,
    });
    completedHistoryBlocks = [];
  };

  for (const block of presentation.displayBlocks) {
    if (
      presentation.completedHistorySummary
      && blockBelongsToCompletedHistory(block, completedHistoryRootIds)
    ) {
      completedHistoryBlocks.push(block);
      continue;
    }

    flushCompletedHistory();
    chunks.push({
      blockKey: getTurnDisplayBlockKey(block),
      blocks: [block],
    });
  }

  flushCompletedHistory();
  return chunks;
}

function blockBelongsToCompletedHistory(
  block: TurnDisplayBlock,
  completedHistoryRootIds: ReadonlySet<string>,
): boolean {
  if (
    block.kind === "collapsed_actions"
    || block.kind === "inline_tools"
    || block.kind === "subagent_creations"
  ) {
    return block.itemIds.every((itemId) => completedHistoryRootIds.has(itemId));
  }
  return completedHistoryRootIds.has(block.itemId);
}

function getTurnDisplayBlockKey(block: TurnDisplayBlock): string {
  if (block.kind === "collapsed_actions") {
    return block.itemIds[0] ?? block.blockId;
  }
  if (block.kind === "inline_tool") {
    return block.itemId;
  }
  if (block.kind === "inline_tools") {
    return block.itemIds[0] ?? block.blockId;
  }
  if (block.kind === "subagent_creations") {
    return block.blockId;
  }
  return block.itemId;
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
