import type {
  TranscriptItem,
  TranscriptState,
  ToolCallItem,
  TurnRecord,
} from "@anyharness/sdk";
import { summarizeCollapsedActions } from "@proliferate/product-model/chats/transcript/transcript-collapsed-actions";
import {
  type TurnDisplayBlock,
  type TurnPresentation,
} from "@proliferate/product-model/chats/transcript/transcript-presentation";
import type { PromptOutboxEntry } from "@/lib/domain/sessions/intents/session-intent-model";

const EMPTY_OUTBOX_STARTED_AT_BY_PROMPT_ID = new Map<string, string>();

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

export function collectToolCallIdsWithProposedPlan(
  transcript: TranscriptState,
): Set<string> {
  const toolCallIds = new Set<string>();
  for (const item of Object.values(transcript.itemsById)) {
    if (item.kind === "proposed_plan") {
      addProposedPlanSourceIds(item.plan, toolCallIds);
    }
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

export function collectToolCallIdsWithProposedPlanForBlocks(
  displayBlocks: readonly TurnDisplayBlock[],
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
): Set<string> {
  const toolCallIds = new Set<string>();
  for (const block of displayBlocks) {
    if (
      block.kind === "collapsed_actions"
      || block.kind === "inline_tools"
      || block.kind === "subagent_creations"
    ) {
      for (const itemId of block.itemIds) {
        collectToolCallIdsWithProposedPlanFromItem(
          itemId,
          transcript,
          childrenByParentId,
          toolCallIds,
        );
      }
      continue;
    }
    collectToolCallIdsWithProposedPlanFromItem(
      block.itemId,
      transcript,
      childrenByParentId,
      toolCallIds,
    );
  }
  return toolCallIds;
}

function collectToolCallIdsWithProposedPlanFromItem(
  itemId: string,
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
  output: Set<string>,
): void {
  const item = transcript.itemsById[itemId];
  if (item?.kind === "proposed_plan") {
    addProposedPlanSourceIds(item.plan, output);
  }
  for (const childId of childrenByParentId.get(itemId) ?? []) {
    collectToolCallIdsWithProposedPlanFromItem(
      childId,
      transcript,
      childrenByParentId,
      output,
    );
  }
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

  return shouldForceExpandActionBlock(block.itemIds, transcript, false)
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

  for (let index = displayBlocks.length - 1; index >= 0; index--) {
    const block = displayBlocks[index];
    if (blockContainsActiveToolWork(block, transcript)) {
      return block;
    }
  }

  return null;
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
    return block.itemIds.every((itemId) => completedHistoryRootIds.has(itemId));
  }
  return completedHistoryRootIds.has(block.itemId);
}
