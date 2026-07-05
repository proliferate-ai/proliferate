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
  | { kind: "subagent_creations"; blockId: string; itemIds: string[] }
  // A native-harness subagent's own work (Claude Task tool) that streamed in
  // AFTER its launching `Agent` tool call — the background/async case, where
  // the inner tool calls arrive in a later turn than the launch. `buildTurnPresentation`
  // can only attach `parentToolCallId` children living in the SAME turn as their
  // parent; background subagent activity orphans across turns and would otherwise
  // leak into the main thread as loose actions. This block re-binds those orphans
  // to their launching Agent (`parentToolCallId`) as one bounded, collapsible unit
  // with its own start → running → ended lifecycle. `itemIds` are the subagent's
  // root activity items in this turn; nested children hang off `childrenByParentId`.
  | {
      kind: "subagent_activity";
      blockId: string;
      parentToolCallId: string;
      itemIds: string[];
    };

export interface CompletedHistorySummary {
  messages: number;
  toolCalls: number;
  subagents: number;
}

export interface TurnPresentation {
  rootIds: string[];
  childrenByParentId: Map<string, string[]>;
  /** See the `subagent_activity` block — orphaned background-subagent roots keyed to their launching Agent. */
  subagentActivityParentByRootId: Map<string, string>;
  displayBlocks: TurnDisplayBlock[];
  finalAssistantItemId: string | null;
  completedHistoryRootIds: string[];
  completedHistorySummary: CompletedHistorySummary | null;
}

export function buildTranscriptDisplayBlocks({
  rootIds,
  transcript,
  childrenByParentId,
  subagentActivityParentByRootId = EMPTY_SUBAGENT_ACTIVITY_MAP,
}: {
  rootIds: readonly string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  isComplete: boolean;
  /**
   * Root items that are actually a native-harness subagent's own work whose
   * launching `Agent` tool call lives in an EARLIER turn (background/async
   * subagents — see the `subagent_activity` block doc). Maps each such root
   * item id to the launching `parentToolCallId`. Empty for same-turn work and
   * for scoped recursion (where children are already bound to their agent).
   */
  subagentActivityParentByRootId?: ReadonlyMap<string, string>;
}): TurnDisplayBlock[] {
  const visibleRootIds = rootIds.filter((itemId) =>
    !isHiddenTranscriptPresentationItem(transcript.itemsById[itemId])
  );
  const blocks: TurnDisplayBlock[] = [];
  let pendingActionIds: string[] = [];
  let pendingSubagentCreationIds: string[] = [];
  // One subagent_activity block per launching Agent, positioned at that
  // subagent's first appearance. Interleaved concurrent subagents each get a
  // single bounded block (not one per burst), so N background subagents read
  // as exactly N labeled units — the point of the grouping.
  const subagentActivityBlockByParent = new Map<
    string,
    Extract<TurnDisplayBlock, { kind: "subagent_activity" }>
  >();

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
  const flushAll = () => {
    flushSubagentCreations();
    flushActions();
  };

  for (const itemId of visibleRootIds) {
    const item = transcript.itemsById[itemId];
    if (!item) continue;

    const activityParent = subagentActivityParentByRootId.get(itemId);
    if (activityParent) {
      flushSubagentCreations();
      flushActions();
      const existing = subagentActivityBlockByParent.get(activityParent);
      if (existing) {
        // Same subagent reappearing after other work interleaved — append to
        // its one block rather than opening a second.
        existing.itemIds.push(itemId);
      } else {
        const block: Extract<TurnDisplayBlock, { kind: "subagent_activity" }> = {
          kind: "subagent_activity",
          blockId: `subagent-activity-${activityParent}`,
          parentToolCallId: activityParent,
          itemIds: [itemId],
        };
        subagentActivityBlockByParent.set(activityParent, block);
        blocks.push(block);
      }
      continue;
    }

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

    flushAll();
    blocks.push({ kind: "item", itemId });
  }

  flushAll();
  return blocks;
}

const EMPTY_SUBAGENT_ACTIVITY_MAP: ReadonlyMap<string, string> = new Map();

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
  // Native-harness (Claude Task) subagent activity whose launching `Agent` tool
  // call is NOT in this turn — the background/async case. These items carry a
  // `parentToolCallId` pointing at an out-of-turn Agent, so they can't attach to
  // a same-turn parent and would otherwise render as loose main-thread actions.
  // We re-collect them under their launching id here (deepest-first, so nested
  // tool calls hang off their own parent within the subagent) and hand the
  // roots' parent map to the block builder to wrap them in one bounded block.
  const subagentActivityParentByRootId = new Map<string, string>();

  // Items re-parented under an in-turn parent that itself belongs to orphaned
  // subagent activity — tracked so their own descendants keep nesting instead
  // of surfacing as fresh activity roots.
  const nestedSubagentActivityItemIds = new Set<string>();

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
    // In-turn parent that is itself part of orphaned subagent activity: keep
    // this item nested under it (not a fresh activity root) so deep subagent
    // tool trees render inside the one bounded block.
    if (
      parentId
      && itemIds.has(parentId)
      && (subagentActivityParentByRootId.has(parentId)
        || nestedSubagentActivityItemIds.has(parentId))
    ) {
      childrenByParentId.set(parentId, [
        ...(childrenByParentId.get(parentId) ?? []),
        itemId,
      ]);
      nestedSubagentActivityItemIds.add(itemId);
      continue;
    }
    // Orphaned subagent activity: `parentToolCallId` names a native `Agent`
    // launch that lived in an earlier turn (so it isn't in `itemIds`, and its
    // record isn't loaded here). Surface it as an activity root keyed to the
    // launching id; the block builder re-binds consecutive roots into one block.
    if (parentId && !itemIds.has(parentId)) {
      subagentActivityParentByRootId.set(itemId, parentId);
      rootIds.push(itemId);
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
    subagentActivityParentByRootId,
  );

  return {
    rootIds,
    childrenByParentId,
    subagentActivityParentByRootId,
    displayBlocks: buildTranscriptDisplayBlocks({
      rootIds,
      transcript,
      childrenByParentId,
      isComplete: !!turn.completedAt,
      subagentActivityParentByRootId,
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
  subagentActivityParentByRootId: ReadonlyMap<string, string>,
): string[] {
  if (!completedAt || !finalAssistantItemId) {
    return [];
  }

  const finalAssistantIndex = rootIds.indexOf(finalAssistantItemId);
  if (finalAssistantIndex <= 0) {
    return [];
  }

  return rootIds.filter((itemId, index) =>
    index < finalAssistantIndex
    && transcript.itemsById[itemId]?.kind !== "user_message"
    // Background subagent activity stays a bounded block (with its own agent
    // identity + ended chip) even in completed turns — never buried in the
    // generic "Work history" collapse.
    && !subagentActivityParentByRootId.has(itemId)
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
