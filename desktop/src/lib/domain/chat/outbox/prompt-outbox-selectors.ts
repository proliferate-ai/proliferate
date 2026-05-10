import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import {
  isOutboxEntryTerminal,
  type PromptOutboxDeliveryState,
  type PromptOutboxEntry,
  type PromptOutboxPlacement,
} from "@/lib/domain/chat/outbox/prompt-outbox-model";
import type { PromptOutboxStateShape } from "@/lib/domain/chat/outbox/prompt-outbox-state";
import { isRenderableUserMessageEcho } from "@/lib/domain/chat/outbox/prompt-echo";

export function selectNextDispatchableOutboxEntry(
  state: PromptOutboxStateShape,
  clientSessionId: string,
): PromptOutboxEntry | null {
  const promptIds = state.promptIdsByClientSessionId[clientSessionId] ?? [];
  for (const promptId of promptIds) {
    const entry = state.entriesByPromptId[promptId];
    if (!entry) {
      continue;
    }
    if (entry.deliveryState === "waiting_for_session") {
      return entry;
    }
    if (
      entry.deliveryState === "preparing"
      || entry.deliveryState === "dispatching"
      || entry.deliveryState === "unknown_after_dispatch"
    ) {
      return null;
    }
  }
  return null;
}

export function renderableOutboxEntriesForTranscript(
  entries: readonly PromptOutboxEntry[],
  transcript: TranscriptState,
): PromptOutboxEntry[] {
  if (entries.length === 0) {
    return [];
  }
  const transcriptCandidates = entries.filter(isOutboxTranscriptCandidate);
  if (transcriptCandidates.length === 0) {
    return [];
  }
  const promptIdsToFind = new Set(transcriptCandidates.map((entry) => entry.clientPromptId));
  const echoedPromptIds = collectTranscriptPromptIds(transcript, promptIdsToFind);
  const renderableEntries: PromptOutboxEntry[] = [];
  let hasEarlierBlockingPrompt = false;
  for (const entry of entries) {
    const isEchoed = echoedPromptIds.has(entry.clientPromptId);
    const isFailedBeforeDispatch = entry.deliveryState === "failed_before_dispatch";
    const isTerminal = isOutboxEntryTerminal(entry);
    if (isFailedBeforeDispatch && !isEchoed) {
      renderableEntries.push(entry);
      continue;
    }
    if (
      !hasEarlierBlockingPrompt
      && entry.placement === "transcript"
      && !isTerminal
      && !isEchoed
    ) {
      renderableEntries.push(entry);
    }
    if (!isTerminal && !isEchoed && isOutboxEntryBlockingNewTranscriptPrompt(entry)) {
      hasEarlierBlockingPrompt = true;
    }
  }
  return renderableEntries;
}

export function queuedOutboxEntriesForSession(
  entries: readonly PromptOutboxEntry[],
): PromptOutboxEntry[] {
  return entries.filter((entry) =>
    entry.placement === "queue"
    && (
      entry.deliveryState === "waiting_for_session"
      || entry.deliveryState === "preparing"
      || entry.deliveryState === "dispatching"
      || entry.deliveryState === "accepted_queued"
      || entry.deliveryState === "unknown_after_dispatch"
    )
  );
}

export function resolvePromptOutboxPlacement(input: {
  isSessionBusy: boolean;
  isSessionMaterialized: boolean;
  existingEntries: readonly PromptOutboxEntry[];
}): PromptOutboxPlacement {
  if (input.existingEntries.some(isOutboxEntryBlockingNewTranscriptPrompt)) {
    return "queue";
  }
  if (input.isSessionBusy && input.isSessionMaterialized) {
    return "queue";
  }
  return "transcript";
}

export function outboxEntryToPendingPromptEntry(entry: PromptOutboxEntry): PendingPromptEntry {
  return {
    seq: entry.queuedSeq ?? syntheticQueueSeq(entry.clientPromptId),
    promptId: entry.clientPromptId,
    text: entry.text,
    contentParts: entry.contentParts,
    queuedAt: entry.createdAt,
    promptProvenance: entry.promptProvenance,
    localOutboxDeliveryState: entry.deliveryState,
  } as PendingPromptEntry & { localOutboxDeliveryState: PromptOutboxDeliveryState };
}

function isOutboxEntryBlockingNewTranscriptPrompt(entry: PromptOutboxEntry): boolean {
  switch (entry.deliveryState) {
    case "waiting_for_session":
    case "preparing":
    case "dispatching":
    case "accepted_running":
    case "accepted_queued":
    case "unknown_after_dispatch":
      return true;
    case "failed_before_dispatch":
    case "cancelled":
    case "echoed_tombstone":
      return false;
  }
}

function isOutboxTranscriptCandidate(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "failed_before_dispatch"
    || (entry.placement === "transcript" && !isOutboxEntryTerminal(entry));
}

function collectTranscriptPromptIds(
  transcript: TranscriptState,
  promptIdsToFind?: ReadonlySet<string>,
): Set<string> {
  const promptIds = new Set<string>();
  if (promptIdsToFind?.size === 0) {
    return promptIds;
  }
  for (const item of Object.values(transcript.itemsById)) {
    if (
      item.kind === "user_message"
      && item.promptId
      && isRenderableUserMessageEcho(item)
      && (!promptIdsToFind || promptIdsToFind.has(item.promptId))
    ) {
      promptIds.add(item.promptId);
      if (promptIdsToFind && promptIds.size >= promptIdsToFind.size) {
        break;
      }
    }
  }
  return promptIds;
}

function syntheticQueueSeq(clientPromptId: string): number {
  let hash = 0;
  for (let index = 0; index < clientPromptId.length; index += 1) {
    hash = ((hash << 5) - hash + clientPromptId.charCodeAt(index)) | 0;
  }
  return -Math.abs(hash || 1);
}
