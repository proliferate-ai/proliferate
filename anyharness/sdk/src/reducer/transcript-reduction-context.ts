import type { ContentPart, SessionEventEnvelope } from "../types/events.js";
import type {
  AssistantProseItem,
  ErrorItem,
  PlanItem,
  ProposedPlanItem,
  ThoughtItem,
  ToolCallItem,
  TranscriptItem,
  TranscriptState,
  TurnRecord,
  UserMessageItem,
} from "../types/reducer.js";

export type KnownTranscriptItem =
  | UserMessageItem
  | AssistantProseItem
  | ThoughtItem
  | ToolCallItem
  | PlanItem
  | ProposedPlanItem
  | ErrorItem;

export interface ReduceOptions {
  replayMode?: boolean;
}

export interface TranscriptReductionContext {
  state: TranscriptState;
  copiedItemsById: boolean;
  copiedTurnsById: boolean;
  mutableItemIds: Set<string>;
  mutableTurnIds: Set<string>;
}

type ApplyEvent = (
  context: TranscriptReductionContext,
  envelope: SessionEventEnvelope,
  options?: ReduceOptions,
) => void;

/**
 * Reduces one delivery batch with copy-on-write transcript collections.
 * Stream consumers already flush envelopes once per animation frame, so this
 * avoids cloning full item/turn maps and the same streaming item per delta.
 */
export function reduceTranscriptEventBatch(
  state: TranscriptState,
  envelopes: readonly SessionEventEnvelope[],
  options: ReduceOptions | undefined,
  applyEvent: ApplyEvent,
): TranscriptState {
  if (envelopes.length === 0) {
    return state;
  }

  const context: TranscriptReductionContext = {
    state: { ...state },
    copiedItemsById: false,
    copiedTurnsById: false,
    mutableItemIds: new Set(),
    mutableTurnIds: new Set(),
  };
  for (const envelope of envelopes) {
    applyEvent(context, envelope, options);
  }
  return context.state;
}

export function setContextItem(
  context: TranscriptReductionContext,
  itemId: string,
  item: TranscriptItem,
): void {
  const state = context.state;
  if (!context.copiedItemsById) {
    state.itemsById = { ...state.itemsById };
    context.copiedItemsById = true;
  }
  state.itemsById[itemId] = item;
  context.mutableItemIds.add(itemId);
}

export function setContextTurn(
  context: TranscriptReductionContext,
  turnId: string,
  turn: TurnRecord,
): void {
  const state = context.state;
  if (!context.copiedTurnsById) {
    state.turnsById = { ...state.turnsById };
    context.copiedTurnsById = true;
  }
  state.turnsById[turnId] = turn;
  context.mutableTurnIds.add(turnId);
}

export function ensureMutableContextItem<T extends KnownTranscriptItem>(
  context: TranscriptReductionContext,
  itemId: string,
  item: T,
): T {
  if (context.mutableItemIds.has(itemId)) {
    return item;
  }
  const nextItem = cloneKnownTranscriptItem(item);
  setContextItem(context, itemId, nextItem);
  return nextItem;
}

export function ensureMutableContextTurn(
  context: TranscriptReductionContext,
  turnId: string,
  turn: TurnRecord,
): TurnRecord {
  if (context.mutableTurnIds.has(turnId)) {
    return turn;
  }
  const nextTurn = {
    ...turn,
    itemOrder: [...turn.itemOrder],
    fileBadges: [...turn.fileBadges],
  };
  setContextTurn(context, turnId, nextTurn);
  return nextTurn;
}

function cloneKnownTranscriptItem<T extends KnownTranscriptItem>(item: T): T {
  const cloned = {
    ...item,
    contentParts: item.contentParts.map(cloneContentPart),
  };
  if (item.kind === "plan") {
    return { ...cloned, entries: [...item.entries] } as T;
  }
  return cloned as T;
}

function cloneContentPart(part: ContentPart): ContentPart {
  return { ...part } as ContentPart;
}
