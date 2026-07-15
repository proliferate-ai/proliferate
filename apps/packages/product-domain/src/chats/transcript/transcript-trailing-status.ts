import type { TranscriptState } from "@anyharness/sdk";

type TranscriptItemRecord = TranscriptState["itemsById"][string];

export function shouldAllowTurnTrailingStatus({
  turn,
  transcript,
  isLatestTurnInProgress,
}: {
  turn: { itemOrder: readonly string[] };
  transcript: TranscriptState;
  isLatestTurnInProgress: boolean;
}): boolean {
  // Streaming prose owns the live tail while fresh tokens are arriving.
  // Completed prose is not evidence that the turn is over: commentary can be
  // followed by a long period of hidden reasoning before the next visible
  // action. Keep the working status eligible until the turn itself completes.
  return isLatestTurnInProgress
    && latestStreamingAssistantProseRevision(turn, transcript) === null;
}

export function latestStreamingAssistantProseRevision(
  turn: { itemOrder: readonly string[] },
  transcript: TranscriptState,
): string | null {
  const item = findLastTopLevelItem(turn, transcript);
  if (item?.kind !== "assistant_prose" || !item.text || !item.isStreaming) {
    return null;
  }
  return `${item.itemId}:${item.lastUpdatedSeq}`;
}

export function latestTransientStatusText(
  turn: { itemOrder: readonly string[] },
  transcript: TranscriptState,
): string | null {
  for (let i = turn.itemOrder.length - 1; i >= 0; i--) {
    const itemId = turn.itemOrder[i];
    const item = itemId ? transcript.itemsById[itemId] : undefined;
    if (!item) continue;
    if ("parentToolCallId" in item && item.parentToolCallId) {
      const parent = transcript.itemsById[item.parentToolCallId];
      if (parent?.kind === "tool_call") continue;
    }
    if (
      item.kind === "thought"
      && item.isTransient
      && item.isStreaming
      && item.text.trim()
    ) {
      return item.text.trim();
    }
    // A transient label only describes the current tail. Once prose or tool
    // work follows it, reviving the older label would falsely present stale
    // work as the agent's current action.
    return null;
  }
  return null;
}

function findLastTopLevelItem(
  turn: { itemOrder: readonly string[] },
  transcript: TranscriptState,
): TranscriptItemRecord | null {
  for (let i = turn.itemOrder.length - 1; i >= 0; i--) {
    const item = transcript.itemsById[turn.itemOrder[i]];
    if (!item) continue;
    if (item.kind === "thought" && item.isTransient) continue;
    if ("parentToolCallId" in item && item.parentToolCallId) {
      const parent = transcript.itemsById[item.parentToolCallId];
      if (parent?.kind === "tool_call") continue;
    }
    return item;
  }
  return null;
}
