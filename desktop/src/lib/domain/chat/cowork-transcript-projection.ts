import {
  createTranscriptState,
  type TranscriptItem,
  type TranscriptState,
} from "@anyharness/sdk";
import { isArtifactToolCallItem } from "@/lib/domain/chat/artifact-tool-call";

export function projectCoworkTranscript(
  transcript: TranscriptState,
): TranscriptState {
  const projected = createTranscriptState(transcript.sessionMeta.sessionId);
  const visibleItemIds = new Set<string>();

  projected.sessionMeta = { ...transcript.sessionMeta };
  projected.availableCommands = transcript.availableCommands;
  projected.liveConfig = transcript.liveConfig;
  projected.currentModeId = transcript.currentModeId;
  projected.usageState = transcript.usageState;
  projected.unknownEvents = transcript.unknownEvents;
  projected.isStreaming = transcript.isStreaming;
  projected.lastSeq = transcript.lastSeq;
  projected.pendingPrompts = transcript.pendingPrompts;

  for (const [itemId, item] of Object.entries(transcript.itemsById)) {
    if (!shouldKeepCoworkTranscriptItem(item)) {
      continue;
    }
    projected.itemsById[itemId] = item;
    visibleItemIds.add(itemId);
  }

  for (const turnId of transcript.turnOrder) {
    const turn = transcript.turnsById[turnId];
    if (!turn) {
      continue;
    }

    const itemOrder = turn.itemOrder.filter((itemId) => visibleItemIds.has(itemId));
    if (itemOrder.length === 0) {
      continue;
    }

    projected.turnOrder.push(turnId);
    projected.turnsById[turnId] = {
      ...turn,
      itemOrder,
      fileBadges: [],
    };
  }

  projected.openAssistantItemId =
    transcript.openAssistantItemId && visibleItemIds.has(transcript.openAssistantItemId)
      ? transcript.openAssistantItemId
      : null;
  projected.openThoughtItemId = null;
  projected.pendingApproval = null;

  return projected;
}

function shouldKeepCoworkTranscriptItem(item: TranscriptItem): boolean {
  switch (item.kind) {
    case "user_message":
    case "assistant_prose":
    case "error":
      return true;
    case "tool_call":
      return isArtifactToolCallItem(item);
    default:
      return false;
  }
}
