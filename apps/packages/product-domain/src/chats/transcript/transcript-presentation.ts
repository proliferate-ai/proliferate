import type {
  TranscriptItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { isSubagentCreationAction } from "../subagents/subagent-tool-presentation";
import { isKnownModeSwitchToolCall } from "../tools/mode-switch-display";

export type TurnDisplayBlock =
  | { kind: "item"; itemId: string }
  | { kind: "inline_tool"; itemId: string }
  | { kind: "inline_tools"; blockId: string; itemIds: string[] }
  | { kind: "collapsed_actions"; blockId: string; itemIds: string[] }
  | { kind: "subagent_creations"; blockId: string; itemIds: string[] };

export interface CompletedHistorySummary {
  messages: number;
  toolCalls: number;
  subagents: number;
}

export interface TurnPresentation {
  rootIds: string[];
  childrenByParentId: Map<string, string[]>;
  displayBlocks: TurnDisplayBlock[];
  finalAssistantItemId: string | null;
  completedHistoryRootIds: string[];
  completedHistorySummary: CompletedHistorySummary | null;
}

export function buildTranscriptDisplayBlocks({
  rootIds,
  transcript,
  childrenByParentId,
}: {
  rootIds: readonly string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  isComplete: boolean;
}): TurnDisplayBlock[] {
  const visibleRootIds = rootIds.filter((itemId) =>
    !isHiddenTranscriptPresentationItem(transcript.itemsById[itemId])
  );
  const blocks: TurnDisplayBlock[] = [];
  let pendingActionIds: string[] = [];
  let pendingSubagentCreationIds: string[] = [];

  const flushActions = () => {
    if (pendingActionIds.length === 0) return;
    const firstId = pendingActionIds[0] ?? "actions";
    const lastId = pendingActionIds[pendingActionIds.length - 1] ?? firstId;
    blocks.push({
      kind: "collapsed_actions",
      blockId: `${firstId}-${lastId}`,
      itemIds: pendingActionIds,
    });
    pendingActionIds = [];
  };
  const flushSubagentCreations = () => {
    if (pendingSubagentCreationIds.length === 0) return;
    const firstId = pendingSubagentCreationIds[0] ?? "subagent-creations";
    const lastId = pendingSubagentCreationIds[pendingSubagentCreationIds.length - 1] ?? firstId;
    blocks.push({
      kind: "subagent_creations",
      blockId: `${firstId}-${lastId}`,
      itemIds: pendingSubagentCreationIds,
    });
    pendingSubagentCreationIds = [];
  };

  for (const itemId of visibleRootIds) {
    const item = transcript.itemsById[itemId];
    if (!item) continue;

    if (item.kind === "tool_call" && isSubagentCreationAction(item)) {
      flushActions();
      pendingSubagentCreationIds.push(itemId);
      continue;
    }

    if (item.kind === "tool_call" && isCollapsibleAction(item, childrenByParentId)) {
      flushSubagentCreations();
      pendingActionIds.push(itemId);
      continue;
    }

    flushSubagentCreations();
    flushActions();
    blocks.push({ kind: "item", itemId });
  }

  flushSubagentCreations();
  flushActions();
  return blocks;
}

export function buildTurnPresentation(
  turn: TurnRecord,
  transcript: TranscriptState,
): TurnPresentation {
  const itemOrderIndex = new Map(turn.itemOrder.map((itemId, index) => [itemId, index]));
  const orderedItemIds = [...turn.itemOrder]
    .filter((itemId) => !isTransientTranscriptItem(transcript.itemsById[itemId]))
    .filter((itemId) => !isHiddenTranscriptPresentationItem(transcript.itemsById[itemId]))
    .sort((leftId, rightId) =>
      compareItems(leftId, rightId, transcript, itemOrderIndex)
    );

  const itemIds = new Set(orderedItemIds);
  const childrenByParentId = new Map<string, string[]>();
  const rootIds: string[] = [];

  for (const itemId of orderedItemIds) {
    const item = transcript.itemsById[itemId];
    const parentId = item && "parentToolCallId" in item ? item.parentToolCallId : null;
    const parent = parentId ? transcript.itemsById[parentId] : undefined;
    if (
      parentId
      && itemIds.has(parentId)
      && shouldGroupToolChildren(parent)
    ) {
      childrenByParentId.set(parentId, [
        ...(childrenByParentId.get(parentId) ?? []),
        itemId,
      ]);
      continue;
    }
    rootIds.push(itemId);
  }

  const finalAssistantItemId = turn.completedAt
    ? [...rootIds].reverse().find((itemId) => transcript.itemsById[itemId]?.kind === "assistant_prose") ?? null
    : null;
  const completedHistoryRootIds = buildCompletedHistoryRootIds(
    rootIds,
    transcript,
    turn.completedAt,
    finalAssistantItemId,
  );

  return {
    rootIds,
    childrenByParentId,
    displayBlocks: buildTranscriptDisplayBlocks({
      rootIds,
      transcript,
      childrenByParentId,
      isComplete: !!turn.completedAt,
    }),
    finalAssistantItemId,
    completedHistoryRootIds,
    completedHistorySummary: summarizeCompletedHistory(
      completedHistoryRootIds,
      transcript,
      childrenByParentId,
    ),
  };
}

export function isTransientTranscriptItem(item: TranscriptItem | undefined): boolean {
  return item?.kind === "thought" && item.isTransient === true;
}

export function isHiddenTranscriptPresentationItem(
  item: TranscriptItem | undefined,
): boolean {
  return item?.kind === "tool_call" && item.semanticKind === "hook";
}

function shouldGroupToolChildren(item: TranscriptItem | undefined): boolean {
  return item?.kind === "tool_call"
    && (item.semanticKind === "subagent" || item.nativeToolName === "Agent");
}

function compareItems(
  leftId: string,
  rightId: string,
  transcript: TranscriptState,
  itemOrderIndex: Map<string, number>,
): number {
  const left = transcript.itemsById[leftId];
  const right = transcript.itemsById[rightId];
  const leftSeq = getStartedSeq(left);
  const rightSeq = getStartedSeq(right);

  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }

  return (itemOrderIndex.get(leftId) ?? 0) - (itemOrderIndex.get(rightId) ?? 0);
}

function getStartedSeq(item: TranscriptItem | undefined): number {
  if (!item) {
    return Number.MAX_SAFE_INTEGER;
  }
  return (item as { startedSeq: number }).startedSeq;
}

function buildCompletedHistoryRootIds(
  rootIds: readonly string[],
  transcript: TranscriptState,
  completedAt: string | null,
  finalAssistantItemId: string | null,
): string[] {
  if (!completedAt || !finalAssistantItemId) {
    return [];
  }

  const finalAssistantIndex = rootIds.indexOf(finalAssistantItemId);
  if (finalAssistantIndex <= 0) {
    return [];
  }

  return rootIds.filter((itemId, index) =>
    index < finalAssistantIndex && transcript.itemsById[itemId]?.kind !== "user_message"
  );
}

function summarizeCompletedHistory(
  rootIds: readonly string[],
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
): CompletedHistorySummary | null {
  if (rootIds.length === 0) {
    return null;
  }

  const summary = flattenItemIds(rootIds, childrenByParentId).reduce<CompletedHistorySummary>(
    (nextSummary, itemId) => {
      const item = transcript.itemsById[itemId];
      if (!item) {
        return nextSummary;
      }
      if (item.kind === "tool_call") {
        if (item.semanticKind === "subagent") {
          nextSummary.subagents += 1;
        } else {
          nextSummary.toolCalls += 1;
        }
      } else if (
        item.kind === "assistant_prose"
        || item.kind === "thought"
        || item.kind === "plan"
        || item.kind === "error"
      ) {
        nextSummary.messages += 1;
      }
      return nextSummary;
    },
    { messages: 0, toolCalls: 0, subagents: 0 },
  );

  return summary.messages > 0 || summary.toolCalls > 0 || summary.subagents > 0
    ? summary
    : null;
}

function flattenItemIds(
  rootIds: readonly string[],
  childrenByParentId: Map<string, string[]>,
): string[] {
  const flattened: string[] = [];
  for (const itemId of rootIds) {
    flattened.push(itemId);
    const childIds = childrenByParentId.get(itemId) ?? [];
    flattened.push(...flattenItemIds(childIds, childrenByParentId));
  }
  return flattened;
}

function isCollapsibleAction(
  item: Extract<TranscriptItem, { kind: "tool_call" }>,
  childrenByParentId: Map<string, string[]>,
): boolean {
  if ((childrenByParentId.get(item.itemId) ?? []).length > 0) {
    return false;
  }
  // Known mode tools render as standalone phase dividers; other tools the
  // SDK loosely tags `mode_switch` (any name containing "mode") collapse
  // like normal actions.
  return item.semanticKind !== "subagent"
    && !isKnownModeSwitchToolCall(item)
    && item.semanticKind !== "cowork_artifact_create"
    && item.semanticKind !== "cowork_artifact_update"
    && item.nativeToolName !== "Agent";
}
