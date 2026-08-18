import type {
  TranscriptItem,
  TranscriptState,
  ToolCallItem,
  TurnRecord,
} from "@anyharness/sdk";
import {
  resolveCurrentCollapsedAction,
  summarizeCollapsedActions,
} from "./transcript-collapsed-actions";
import {
  type TurnDisplayBlock,
  type TurnPresentation,
} from "./transcript-presentation";
import { resolveTurnAssistantFooterMode } from "./turn-row-presentation";
import type { PromptOutboxEntry } from "../../sessions/intents/session-intent-model";

const EMPTY_OUTBOX_STARTED_AT_BY_PROMPT_ID = new Map<string, string>();
const EMPTY_PROPOSED_PLAN_TOOL_CALL_IDS: ReadonlySet<string> = new Set();

export function buildOutboxStartedAtByPromptId(
  entries: readonly PromptOutboxEntry[],
): ReadonlyMap<string, string> {
  if (entries.length === 0) {
    return EMPTY_OUTBOX_STARTED_AT_BY_PROMPT_ID;
  }
  const startedAtByPromptId = new Map<string, string>();
  for (const entry of entries) {
    startedAtByPromptId.set(entry.clientPromptId, entry.createdAt);
  }
  return startedAtByPromptId;
}

export function resolveTurnPromptTiming(
  turn: TurnRecord,
  transcript: TranscriptState,
  outboxStartedAtByPromptId: ReadonlyMap<string, string>,
): { startedAt: string; isOutboxStartedAt: boolean } {
  for (const itemId of turn.itemOrder) {
    const item = transcript.itemsById[itemId];
    if (item?.kind !== "user_message" || !item.promptId) {
      continue;
    }
    const outboxStartedAt = outboxStartedAtByPromptId.get(item.promptId);
    if (outboxStartedAt) {
      return {
        startedAt: outboxStartedAt,
        isOutboxStartedAt: true,
      };
    }
  }
  return {
    startedAt: turn.startedAt,
    isOutboxStartedAt: false,
  };
}

export function findTailAssistantProseRootId(
  presentation: TurnPresentation,
  transcript: TranscriptState,
): string | null {
  for (let i = presentation.displayBlocks.length - 1; i >= 0; i--) {
    const block = presentation.displayBlocks[i];
    if (block?.kind !== "item") continue;
    const item = transcript.itemsById[block.itemId];
    if (item?.kind === "assistant_prose" && item.text) {
      return block.itemId;
    }
  }
  return null;
}

export function getAssistantProseContent(
  itemId: string | null,
  transcript: TranscriptState,
): string | null {
  if (!itemId) {
    return null;
  }
  const item = transcript.itemsById[itemId];
  return item?.kind === "assistant_prose" && item.text ? item.text : null;
}

/**
 * Resolve the assistant copy/timestamp footer mode for one turn row, sourcing
 * "is this turn done?" from stream/session liveness and the tail assistant
 * MESSAGE rather than only the turn envelope's completion stamp.
 *
 * A runtime-injected wake turn (the background-work finish signal, e.g.
 * "Terminal … finished — exit code 0") never receives the completion tail: the
 * runtime drops both `item_completed` and `turn_ended`, so `TurnRecord`'s
 * `completedAt` stays null AND the tail assistant message item stays status
 * "in_progress" (isStreaming true) forever in the durable record. The bare
 * `!!turn.completedAt` gate — and a tail-item-status gate — therefore leave
 * that final message stuck on the empty "reserved" footer: no copy button, no
 * timestamp, durable across reload. Interleaved `completion_receipt` /
 * `background_work` rows are transparent to this: the affordance belongs to the
 * last real MESSAGE row of a turn regardless of the activity rows the row model
 * places before or after it.
 *
 * Two OR'd completion signals:
 *   1. `turn.completedAt` — a real `turn_ended` stamp (normal turns; the left
 *      branch always wins when present).
 *   2. `messageSettledOffLiveStream` — there is copyable tail prose and this
 *      turn is NOT the session's actively-streaming turn. This is the signal
 *      that survives the dropped completion tail: on reload there is no live
 *      stream, and once the agent stops the session leaves the "working" view
 *      state, so a message whose item is stuck "in_progress" is nonetheless
 *      copyable. An interrupted turn matches too — desired for the affordance.
 *
 * Completion is deliberately NOT sourced from the tail item's own status: the
 * runtime drops `item_completed` for wake turns, so the item stays
 * "in_progress" forever, and a per-item-settle gate also flashes `copy` in the
 * mid-turn gap between a prose block finishing and the next tool_call arriving
 * (a still-live turn indistinguishable from a settled one). Keying on
 * `turnIsActivelyStreaming` (isLatestTurn AND the session view state is
 * "working") instead keeps that gap — and every genuinely live turn — in
 * "reserved", with the reveal guard (`assistantRevealComplete`) holding the
 * empty footer through the reveal.
 */
export function resolveTurnAssistantFooterModeForRow({
  rowIsLastTurnRow,
  turn,
  transcript,
  presentation,
  assistantRevealComplete,
  turnIsActivelyStreaming,
}: {
  rowIsLastTurnRow: boolean;
  turn: TurnRecord;
  transcript: TranscriptState;
  presentation: TurnPresentation;
  assistantRevealComplete: boolean;
  turnIsActivelyStreaming: boolean;
}): "none" | "reserved" | "copy" {
  const tailAssistantProseRootId = findTailAssistantProseRootId(
    presentation,
    transcript,
  );
  const tailAssistantProseContent = getAssistantProseContent(
    tailAssistantProseRootId,
    transcript,
  );
  const messageSettledOffLiveStream = !!tailAssistantProseContent
    && !turnIsActivelyStreaming;
  return resolveTurnAssistantFooterMode({
    rowIsLastTurnRow,
    turnCompleted: !!turn.completedAt || messageSettledOffLiveStream,
    hasAssistantCopyContent: !!tailAssistantProseContent,
    assistantRevealComplete,
  });
}

export function collectToolCallIdsWithProposedPlan(
  transcript: TranscriptState,
  previous: ReadonlySet<string> = EMPTY_PROPOSED_PLAN_TOOL_CALL_IDS,
): ReadonlySet<string> {
  const toolCallIds = new Set<string>();
  for (const item of Object.values(transcript.itemsById)) {
    if (item.kind === "proposed_plan") {
      addProposedPlanSourceIds(item.plan, toolCallIds);
    }
  }
  if (areSetsEqual(toolCallIds, previous)) {
    return previous;
  }
  return toolCallIds;
}

export function hasProposedPlanForToolCallItem(
  proposedPlanToolCallIds: ReadonlySet<string>,
  item: Pick<ToolCallItem, "itemId" | "toolCallId">,
): boolean {
  return Boolean(
    (item.toolCallId && proposedPlanToolCallIds.has(item.toolCallId))
      || proposedPlanToolCallIds.has(item.itemId),
  );
}

function addProposedPlanSourceIds(
  plan: Extract<TranscriptItem, { kind: "proposed_plan" }>["plan"],
  output: Set<string>,
): void {
  if (plan.sourceToolCallId) {
    output.add(plan.sourceToolCallId);
  }
  if (plan.sourceItemId) {
    output.add(plan.sourceItemId);
  }
}

function areSetsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function findTrailingLiveExplorationBlock(
  displayBlocks: readonly TurnDisplayBlock[],
  transcript: TranscriptState,
  isInProgress: boolean,
): Extract<TurnDisplayBlock, { kind: "collapsed_actions" }> | null {
  if (!isInProgress) {
    return null;
  }

  const block = displayBlocks[displayBlocks.length - 1];
  if (block?.kind !== "collapsed_actions") {
    return null;
  }

  // A trailing exploration batch owns the live activity row for the whole
  // exploration phase, not only while one tool item happens to be marked
  // in-progress. Harnesses commonly complete one search/read event before
  // starting the next, and treating that tiny event gap as the end of the
  // phase makes the header drop its shimmer and restart on every command.
  // Prose, a different trailing block, or turn completion still takes
  // ownership immediately because this only considers the final block of an
  // in-progress turn.
  const currentAction = resolveCurrentCollapsedAction(block.itemIds, transcript);
  const currentItem = currentAction
    ? transcript.itemsById[currentAction.itemId]
    : null;
  const currentActionIsExploration = currentAction
    && (
      currentAction.kind === "read"
      || currentAction.kind === "listing"
      || currentAction.kind === "search"
      || currentAction.kind === "fetch"
    );
  return shouldForceExpandActionBlock(block.itemIds, transcript, false)
    && currentActionIsExploration
    && currentItem?.kind === "tool_call"
    && currentItem.status !== "failed"
      ? block
      : null;
}

function shouldForceExpandActionBlock(
  itemIds: readonly string[],
  transcript: TranscriptState,
  isTurnComplete: boolean,
): boolean {
  if (isTurnComplete) {
    return false;
  }

  const summary = summarizeCollapsedActions(itemIds, transcript);
  return summary.reads > 0
    || summary.listings > 0
    || summary.searches > 0
    || summary.fetches > 0;
}

export function findTrailingLiveWorkBlock(
  displayBlocks: readonly TurnDisplayBlock[],
  transcript: TranscriptState,
  isLatestTurnInProgress: boolean,
): TurnDisplayBlock | null {
  if (!isLatestTurnInProgress) {
    return null;
  }

  const trailingBlock = displayBlocks[displayBlocks.length - 1];
  if (trailingBlock?.kind === "inline_tool" || trailingBlock?.kind === "inline_tools") {
    return trailingBlock;
  }

  for (let index = displayBlocks.length - 1; index >= 0; index--) {
    const block = displayBlocks[index];
    if (blockContainsActiveToolWork(block, transcript)) {
      return block;
    }
  }

  return null;
}

export function turnHasActiveToolWork(
  turn: Pick<TurnRecord, "itemOrder">,
  transcript: TranscriptState,
): boolean {
  return turn.itemOrder.some((itemId) =>
    isActiveToolItem(transcript.itemsById[itemId])
  );
}

function blockContainsActiveToolWork(
  block: TurnDisplayBlock | undefined,
  transcript: TranscriptState,
): boolean {
  if (!block) {
    return false;
  }

  if (block.kind === "collapsed_actions" || block.kind === "subagent_creations") {
    return block.itemIds.some((itemId) => isActiveToolItem(transcript.itemsById[itemId]));
  }
  if (block.kind === "inline_tools") {
    return block.itemIds.some((itemId) => isActiveToolItem(transcript.itemsById[itemId]));
  }
  return isActiveToolItem(transcript.itemsById[block.itemId]);
}

function isActiveToolItem(item: TranscriptItem | undefined): boolean {
  return item?.kind === "tool_call"
    && item.status !== "completed"
    && item.status !== "failed";
}

export function blockBelongsToCompletedHistory(
  block: TurnDisplayBlock,
  completedHistoryRootIds: ReadonlySet<string>,
): boolean {
  if (
    block.kind === "collapsed_actions"
    || block.kind === "inline_tools"
    || block.kind === "subagent_creations"
  ) {
    return block.itemIds.length > 0
      && block.itemIds.every((itemId) => completedHistoryRootIds.has(itemId));
  }
  return completedHistoryRootIds.has(block.itemId);
}
