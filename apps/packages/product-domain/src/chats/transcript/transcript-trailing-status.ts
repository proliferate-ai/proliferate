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
  // OWNER RULE: once the turn's tail is assistant prose with text — streaming
  // or completed — no trailing "Thinking…" below it. The final rendered
  // message must be the last thing in the turn; if the agent genuinely keeps
  // working after prose, the next tool/work item announces itself when it
  // arrives. (Previously completed prose re-showed the indicator, which read
  // as "thinking…" lingering under an already-finished answer whenever
  // turn_ended trailed the final tokens.)
  return isLatestTurnInProgress
    && !lastTopLevelItemIsAssistantProseWithText(turn, transcript);
}

export function lastTopLevelItemIsAssistantProseWithText(
  turn: { itemOrder: readonly string[] },
  transcript: TranscriptState,
): boolean {
  const item = findLastTopLevelItem(turn, transcript);
  return item?.kind === "assistant_prose" && !!item.text;
}

/**
 * True when the transcript's latest turn is still in progress but already
 * ends in completed assistant prose — the "settling" window between the final
 * rendered answer and the backend's turn_ended/phase flip. Session-level
 * status presentation uses this to stop showing "iterating" once the answer
 * is fully on screen, mirroring how shouldAllowTurnTrailingStatus suppresses
 * the trailing "Thinking…" indicator. A prose tail that is still streaming
 * does NOT count: genuinely running states stay authoritative.
 */
export function transcriptEndsInFinalAssistantProse(
  transcript: TranscriptState,
): boolean {
  const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1];
  const turn = latestTurnId ? transcript.turnsById[latestTurnId] : undefined;
  if (!turn || turn.completedAt !== null) {
    return false;
  }
  const item = findLastTopLevelItem(turn, transcript);
  return item?.kind === "assistant_prose" && !!item.text && !item.isStreaming;
}

export function latestTransientStatusText(
  turn: { itemOrder: readonly string[] },
  transcript: TranscriptState,
): string | null {
  for (let i = turn.itemOrder.length - 1; i >= 0; i--) {
    const itemId = turn.itemOrder[i];
    const item = itemId ? transcript.itemsById[itemId] : undefined;
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
    if (item.kind === "thought" && item.isTransient) continue;
    if ("parentToolCallId" in item && item.parentToolCallId) {
      const parent = transcript.itemsById[item.parentToolCallId];
      if (parent?.kind === "tool_call") continue;
    }
    return item;
  }
  return null;
}
