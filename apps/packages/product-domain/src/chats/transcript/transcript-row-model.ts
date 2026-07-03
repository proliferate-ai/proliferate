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
   *   - "set" / "edited" rows anchor at the START of the turn during which
   *     the goal was armed — rendered immediately after that turn's leading
   *     user-message row, before any assistant content. `goal_updated`'s seq
   *     is assigned at native-confirmation time, which lands *after* the
   *     assistant has already started producing content for the turn — so
   *     "armed during turn N" is detected by the event's seq falling before
   *     that turn's *last* item, not just after its first.
   *   - "met" / "cleared" / status-change rows (paused/resumed/blocked/
   *     failed) anchor at the END of the turn in which they occurred —
   *     rendered after that turn's content, same as a "set"/"edited" event
   *     that landed while idle between turns (no later turn content to sit
   *     ahead of).
   *   - Events with no host turn (session start, or a goal set before any
   *     turn ever ran) lead the row list.
   *
   * The row assembly is a single forward pass over `transcript.turnOrder`
   * that splices each turn's start/end goal rows immediately adjacent to
   * that turn's own rows — this makes strict monotonicity a structural
   * property, not something bucketing has to get right after the fact: a
   * turn N+1 row can never be pushed before a row anchored to turn N or
   * earlier.
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
  leadingSplitIndex: number;
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
    const turnStartGoalRows = goalRows.startByTurnId.get(turnId) ?? EMPTY_GOAL_ROWS;
    const { rows: turnRows, leadingSplitIndex } = buildTurnRows(
      turn,
      transcript,
      cache,
      turnStartGoalRows.length > 0,
    );
    // Splice start-anchored rows in at the turn's own start boundary
    // (`leadingSplitIndex`, right after its leading user-message row) and
    // end-anchored rows after all of the turn's rows — both adjacent to
    // this turn's own push, so a later turn can never land ahead of them.
    rows.push(...turnRows.slice(0, leadingSplitIndex));
    rows.push(...turnStartGoalRows);
    rows.push(...turnRows.slice(leadingSplitIndex));
    const turnEndGoalRows = goalRows.endByTurnId.get(turnId);
    if (turnEndGoalRows) {
      rows.push(...turnEndGoalRows);
    }
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

/** "set"/"edited" anchor at their host turn's START (unless armed idle —
 * see `bucketGoalEventRows`); every other kind anchors at the END. */
function isStartAnchoredGoalEventKind(kind: GoalTranscriptEvent["kind"]): boolean {
  return kind === "set" || kind === "edited";
}

interface GoalEventRowBuckets {
  beforeFirstTurn: GoalEventRow[];
  startByTurnId: Map<string, GoalEventRow[]>;
  endByTurnId: Map<string, GoalEventRow[]>;
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
 * Within its host turn, an event is MID-TURN when the turn has an item that
 * started *after* the event's seq — proof the turn was still actively
 * producing content when the event landed (this is what happens for
 * `goal_updated`: its seq is assigned at native-confirmation time, which is
 * after the assistant has already started the turn's response). A
 * mid-turn, start-anchored event (set/edited) buckets to that turn's START
 * so it renders right after the turn's leading user-message row, before any
 * assistant content — never at the tail behind content that, chronologically,
 * came *after* it. Every other case (end-anchored kinds, or a start-anchored
 * kind that landed idle — i.e. after all of its host turn's content, with no
 * turn running) buckets to that turn's END, which reads as "between the
 * turns" once the next turn's rows are appended after it.
 */
function bucketGoalEventRows(
  goalEvents: readonly GoalTranscriptEvent[],
  transcript: TranscriptState,
): GoalEventRowBuckets {
  const beforeFirstTurn: GoalEventRow[] = [];
  const startByTurnId = new Map<string, GoalEventRow[]>();
  const endByTurnId = new Map<string, GoalEventRow[]>();
  if (goalEvents.length === 0) {
    return { beforeFirstTurn, startByTurnId, endByTurnId };
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

    const isMidTurn = event.seq < host.range.maxSeq;
    const targetMap = isMidTurn && isStartAnchoredGoalEventKind(event.kind)
      ? startByTurnId
      : endByTurnId;
    const bucket = targetMap.get(host.turnId);
    if (bucket) {
      bucket.push(row);
    } else {
      targetMap.set(host.turnId, [row]);
    }
  }

  return { beforeFirstTurn, startByTurnId, endByTurnId };
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
  /**
   * Index into `rows` at which start-anchored goal rows should be spliced
   * in — i.e. how many of the leading rows constitute "before any assistant
   * content" (the turn's leading user-message row, when one was carved out).
   * 0 when there's nothing to anchor after, so start-anchored rows lead the
   * turn's own rows entirely.
   */
  leadingSplitIndex: number;
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
    return { rows: cached.rows, leadingSplitIndex: cached.leadingSplitIndex };
  }

  const presentation = buildTurnPresentation(turn, transcript);
  const { rows, leadingSplitIndex } = buildRowsForTurnPresentation(
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
    leadingSplitIndex,
  });
  return { rows, leadingSplitIndex };
}

function buildRowsForTurnPresentation(
  turn: TurnRecord,
  transcript: TranscriptState,
  presentation: TurnPresentation,
  needsLeadingSplit: boolean,
): TurnRowsResult {
  const chunks = shouldSplitTurnIntoRows(turn, presentation)
    ? chunkTurnDisplayBlocks(presentation)
    : [];
  if (chunks.length > 1) {
    const rows = chunks.map((chunk, index) => {
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
    // Large-turn chunking always carves the leading user-message item into
    // its own first chunk (completed-history collapsing explicitly excludes
    // user_message items — see `buildCompletedHistoryRootIds`), so the
    // start boundary is right after row 0.
    return { rows, leadingSplitIndex: 1 };
  }

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
      return { rows: [leadingRow, restRow], leadingSplitIndex: 1 };
    }

    // No leading user-message block to carve a row out of (or the turn is
    // nothing but the user message so far, with no assistant content to
    // split it from) — keep the single row, but still tell the caller
    // whether a start-anchored goal row belongs before it (no user-message
    // row exists to render after) or after it (the only row IS the user
    // message; there's no assistant content for the goal row to precede).
    const singleRow = buildTurnRow({
      turnId: turn.turnId,
      blockKey: TURN_CONTENT_BLOCK_KEY,
      presentation,
      renderPresentation: presentation,
      isFirstTurnRow: true,
      isLastTurnRow: true,
    });
    return { rows: [singleRow], leadingSplitIndex: leadingCount > 0 ? 1 : 0 };
  }

  return {
    rows: [buildTurnRow({
      turnId: turn.turnId,
      blockKey: TURN_CONTENT_BLOCK_KEY,
      presentation,
      renderPresentation: presentation,
      isFirstTurnRow: true,
      isLastTurnRow: true,
    })],
    leadingSplitIndex: 0,
  };
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
