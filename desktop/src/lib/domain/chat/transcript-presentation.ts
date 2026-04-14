import type {
  TranscriptItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";

export interface ReadGroupSummary {
  reads: number;
  searches: number;
  fetches: number;
}

export interface ReadGroup {
  anchorId: string;
  memberIds: string[];
  summary: ReadGroupSummary;
  status: "running" | "completed";
}

export interface TurnPresentation {
  rootIds: string[];
  childrenByParentId: Map<string, string[]>;
  collapsedRootIds: Set<string>;
  collapsedSummary: {
    messages: number;
    toolCalls: number;
    subagents: number;
  } | null;
  finalAssistantItemId: string | null;
  readGroups: Map<string, ReadGroup>;
  readGroupedIds: Set<string>;
}

export function buildTurnPresentation(
  turn: TurnRecord,
  transcript: TranscriptState,
): TurnPresentation {
  const itemOrderIndex = new Map(turn.itemOrder.map((itemId, index) => [itemId, index]));
  const orderedItemIds = [...turn.itemOrder]
    .filter((itemId) => !isTransientTranscriptItem(transcript.itemsById[itemId]))
    .sort((leftId, rightId) =>
      compareItems(leftId, rightId, transcript, itemOrderIndex)
    );

  const itemIds = new Set(orderedItemIds);
  const childrenByParentId = new Map<string, string[]>();
  const rootIds: string[] = [];

  for (const itemId of orderedItemIds) {
    const item = transcript.itemsById[itemId];
    const parentId = item && "parentToolCallId" in item ? item.parentToolCallId : null;
    if (
      parentId
      && itemIds.has(parentId)
      && transcript.itemsById[parentId]?.kind === "tool_call"
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

  if (!turn.completedAt || !finalAssistantItemId) {
    const noCollapsed = new Set<string>();
    const { readGroups, readGroupedIds } = buildReadGroups(rootIds, transcript, noCollapsed);
    return {
      rootIds,
      childrenByParentId,
      collapsedRootIds: noCollapsed,
      collapsedSummary: null,
      finalAssistantItemId,
      readGroups,
      readGroupedIds,
    };
  }

  const finalAssistantIndex = rootIds.indexOf(finalAssistantItemId);
  const collapsedRootIds = new Set(
    rootIds.filter((itemId, index) =>
      index < finalAssistantIndex && transcript.itemsById[itemId]?.kind !== "user_message"
    ),
  );

  if (collapsedRootIds.size === 0) {
    const { readGroups, readGroupedIds } = buildReadGroups(rootIds, transcript, collapsedRootIds);
    return {
      rootIds,
      childrenByParentId,
      collapsedRootIds,
      collapsedSummary: null,
      finalAssistantItemId,
      readGroups,
      readGroupedIds,
    };
  }

  const collapsedItemIds = flattenItemIds(
    rootIds.filter((itemId) => collapsedRootIds.has(itemId)),
    childrenByParentId,
  );

  const collapsedSummary = collapsedItemIds.reduce(
    (summary, itemId) => {
      const item = transcript.itemsById[itemId];
      if (!item) {
        return summary;
      }
      if (item.kind === "tool_call") {
        if (item.semanticKind === "subagent") {
          summary.subagents += 1;
        } else {
          summary.toolCalls += 1;
        }
      } else if (
        item.kind === "assistant_prose"
        || item.kind === "thought"
        || item.kind === "plan"
        || item.kind === "error"
      ) {
        summary.messages += 1;
      }
      return summary;
    },
    { messages: 0, toolCalls: 0, subagents: 0 },
  );

  const { readGroups, readGroupedIds } = buildReadGroups(rootIds, transcript, collapsedRootIds);
  return {
    rootIds,
    childrenByParentId,
    collapsedRootIds,
    collapsedSummary,
    finalAssistantItemId,
    readGroups,
    readGroupedIds,
  };
}

export function isTransientTranscriptItem(item: TranscriptItem | undefined): boolean {
  return !!item && "isTransient" in item && item.isTransient === true;
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

function flattenItemIds(
  rootIds: string[],
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

const NON_DESTRUCTIVE_KINDS = new Set(["file_read", "search", "fetch"]);
const READ_GROUP_MIN_SIZE = 2;

function isNonDestructiveToolCall(item: TranscriptItem | undefined): boolean {
  return (
    !!item
    && item.kind === "tool_call"
    && NON_DESTRUCTIVE_KINDS.has(item.semanticKind)
  );
}

function buildReadGroups(
  rootIds: string[],
  transcript: TranscriptState,
  collapsedRootIds: Set<string>,
): { readGroups: Map<string, ReadGroup>; readGroupedIds: Set<string> } {
  const readGroups = new Map<string, ReadGroup>();
  const readGroupedIds = new Set<string>();
  let runStart = -1;

  for (let i = 0; i <= rootIds.length; i++) {
    const itemId = rootIds[i];
    const item = itemId ? transcript.itemsById[itemId] : undefined;
    const eligible =
      !!itemId && !collapsedRootIds.has(itemId) && isNonDestructiveToolCall(item);

    if (eligible) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        sealReadGroup(rootIds, runStart, i - 1, transcript, readGroups, readGroupedIds);
        runStart = -1;
      }
    }
  }

  return { readGroups, readGroupedIds };
}

function sealReadGroup(
  rootIds: string[],
  start: number,
  end: number,
  transcript: TranscriptState,
  readGroups: Map<string, ReadGroup>,
  readGroupedIds: Set<string>,
): void {
  const groupSize = end - start + 1;
  if (groupSize < READ_GROUP_MIN_SIZE) return;

  const memberIds = rootIds.slice(start, end + 1);
  const anchorId = memberIds[0];
  const summary: ReadGroupSummary = { reads: 0, searches: 0, fetches: 0 };
  let status: "running" | "completed" = "completed";

  for (const id of memberIds) {
    const item = transcript.itemsById[id];
    if (item?.kind === "tool_call") {
      if (item.semanticKind === "file_read") summary.reads++;
      else if (item.semanticKind === "search") summary.searches++;
      else if (item.semanticKind === "fetch") summary.fetches++;
      if (item.status === "in_progress") status = "running";
    }
  }

  readGroups.set(anchorId, { anchorId, memberIds, summary, status });
  for (const id of memberIds) {
    readGroupedIds.add(id);
  }
}

export function formatReadGroupHeader(group: ReadGroup): string {
  const { reads, searches, fetches } = group.summary;
  if (group.status === "running") {
    const fragments: string[] = [];
    if (reads > 0) {
      fragments.push(reads === 1 ? "reading a file" : `reading ${reads} files`);
    }
    if (searches > 0) fragments.push("searching");
    if (fetches > 0) fragments.push("fetching");
    if (fragments.length === 0) return "Working";
    const joined = fragments.join(", ");
    return joined.charAt(0).toUpperCase() + joined.slice(1);
  }

  return [
    formatPlural(reads, "read"),
    formatPlural(searches, "search", "searches"),
    formatPlural(fetches, "fetch", "fetches"),
  ]
    .filter((value): value is string => value !== null)
    .join(", ");
}

function formatPlural(count: number, singular: string, plural?: string): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? singular : (plural ?? singular + "s")}`;
}
