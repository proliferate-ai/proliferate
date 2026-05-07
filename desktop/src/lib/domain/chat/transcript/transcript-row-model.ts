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
} from "@/lib/domain/chat/transcript/transcript-presentation";
import { turnHasRenderableTranscriptContent } from "@/lib/domain/chat/outbox/pending-prompts";
import type { PromptOutboxEntry } from "@/lib/domain/chat/outbox/prompt-outbox";

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
  };

export interface BuildTranscriptRowModelInput {
  activeSessionId: string;
  transcript: TranscriptState;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  visibleOutboxEntries?: readonly PromptOutboxEntry[];
  latestTurnId: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
}

export interface TranscriptRowModelCache {
  turnRowsById: Map<string, CachedTurnRow>;
}

interface CachedTurnRow {
  turn: TurnRecord;
  itemRefs: readonly (TranscriptItem | null)[];
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
      && !turnHasRenderableTranscriptContent(turn, transcript)
    ) {
      continue;
    }

    seenTurnIds.add(turnId);
    rows.push(...buildTurnRows(turn, transcript, cache));
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

function buildTurnRows(
  turn: TurnRecord,
  transcript: TranscriptState,
  cache?: TranscriptRowModelCache,
): readonly Extract<TranscriptRow, { kind: "turn" }>[] {
  const itemRefs = collectTurnItemRefs(turn, transcript);
  const cached = cache?.turnRowsById.get(turn.turnId) ?? null;
  if (
    cached
    && cached.turn === turn
    && areItemRefsEqual(cached.itemRefs, itemRefs)
  ) {
    return cached.rows;
  }

  const presentation = buildTurnPresentation(turn, transcript);
  const rows = buildRowsForTurnPresentation(turn, presentation);
  cache?.turnRowsById.set(turn.turnId, {
    turn,
    itemRefs,
    rows,
  });
  return rows;
}

function buildRowsForTurnPresentation(
  turn: TurnRecord,
  presentation: TurnPresentation,
): readonly Extract<TranscriptRow, { kind: "turn" }>[] {
  const chunks = shouldSplitTurnIntoRows(turn, presentation)
    ? chunkTurnDisplayBlocks(presentation)
    : [];
  if (chunks.length <= 1) {
    return [buildTurnRow({
      turnId: turn.turnId,
      blockKey: TURN_CONTENT_BLOCK_KEY,
      presentation,
      renderPresentation: presentation,
      isFirstTurnRow: true,
      isLastTurnRow: true,
    })];
  }

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
  return turn.itemOrder.length >= SPLIT_TURN_MIN_ITEM_COUNT
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
  if (block.kind === "collapsed_actions" || block.kind === "inline_tools") {
    return block.itemIds.every((itemId) => completedHistoryRootIds.has(itemId));
  }
  return completedHistoryRootIds.has(block.itemId);
}

function getTurnDisplayBlockKey(block: TurnDisplayBlock): string {
  if (block.kind === "collapsed_actions" || block.kind === "inline_tools") {
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
