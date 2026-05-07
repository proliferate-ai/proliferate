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
  return isLatestTurnInProgress
    && !lastTopLevelItemIsStreamingAssistantProse(turn, transcript);
}

export function lastTopLevelItemIsAssistantProseWithText(
  turn: { itemOrder: readonly string[] },
  transcript: TranscriptState,
): boolean {
  const item = findLastTopLevelItem(turn, transcript);
  return item?.kind === "assistant_prose" && !!item.text;
}

export function lastTopLevelItemIsStreamingAssistantProse(
  turn: { itemOrder: readonly string[] },
  transcript: TranscriptState,
): boolean {
  const item = findLastTopLevelItem(turn, transcript);
  return item?.kind === "assistant_prose" && !!item.text && item.isStreaming;
}

export function latestTransientStatusText(
  turn: { itemOrder: readonly string[] },
  transcript: TranscriptState,
): string | null {
  for (let i = turn.itemOrder.length - 1; i >= 0; i--) {
    const item = transcript.itemsById[turn.itemOrder[i]];
    if (item?.kind === "thought" && item.isTransient && item.text.trim()) {
      return item.text.trim();
    }
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
    if ("parentToolCallId" in item && item.parentToolCallId) {
      const parent = transcript.itemsById[item.parentToolCallId];
      if (parent?.kind === "tool_call") continue;
    }
    return item;
  }
  return null;
}
