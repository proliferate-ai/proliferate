import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import {
  isOutboxEntryTerminal,
  isSessionIntentTerminal,
  type PromptOutboxDeliveryState,
  type PromptOutboxEntry,
  type PromptOutboxPlacement,
  type SessionIntent,
  type SessionUpdateConfigIntent,
} from "@/lib/domain/sessions/intents/session-intent-model";
import type { SessionIntentStateShape } from "@/lib/domain/sessions/intents/session-intent-state";
import { isRenderableUserMessageEcho } from "@/lib/domain/sessions/intents/prompt-echo";
import type {
  PendingSessionConfigChange,
  PendingSessionConfigChanges,
} from "@/lib/domain/sessions/pending-config";

export function selectNextDispatchableSessionIntent(
  state: SessionIntentStateShape,
  clientSessionId: string,
): SessionIntent | null {
  const intentIds = state.intentIdsByClientSessionId[clientSessionId] ?? [];
  for (const intentId of intentIds) {
    const intent = state.entriesById[intentId];
    if (!intent) {
      continue;
    }
    if (isIntentDispatchable(intent)) {
      return intent;
    }
    if (!isSessionIntentTerminal(intent) && isIntentBlockingDispatch(intent)) {
      return null;
    }
  }
  return null;
}

export function selectNextDispatchableOutboxEntry(
  state: SessionIntentStateShape,
  clientSessionId: string,
): PromptOutboxEntry | null {
  const intent = selectNextDispatchableSessionIntent(state, clientSessionId);
  return intent?.kind === "send_prompt" ? intent : null;
}

export function pendingConfigChangesForSessionIntents(
  intents: readonly SessionIntent[],
): PendingSessionConfigChanges {
  const pendingConfigChanges: PendingSessionConfigChanges = {};
  for (const intent of intents) {
    if (intent.kind !== "update_config") {
      continue;
    }
    const pendingChange = pendingConfigChangeFromIntent(intent);
    if (pendingChange) {
      pendingConfigChanges[intent.configId] = pendingChange;
    }
  }
  return pendingConfigChanges;
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

export function projectPendingPromptsWithSessionIntents(
  pendingPrompts: readonly PendingPromptEntry[],
  intents: readonly SessionIntent[],
): PendingPromptEntry[] {
  if (pendingPrompts.length === 0 || intents.length === 0) {
    return [...pendingPrompts];
  }
  let projected = pendingPrompts.map((entry) => ({
    ...entry,
    contentParts: entry.contentParts.map((part) => ({ ...part })),
  }));
  for (const intent of intents) {
    if (!isActivePendingPromptMutationIntent(intent)) {
      continue;
    }
    if (intent.kind === "edit_pending_prompt") {
      projected = projected.map((entry) =>
        entry.seq === intent.seq
          ? {
              ...entry,
              text: intent.text,
              contentParts: intent.text ? [{ type: "text", text: intent.text }] : [],
            }
          : entry
      );
      continue;
    }
    projected = projected.filter((entry) => entry.seq !== intent.seq);
  }
  return projected;
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

function isIntentDispatchable(intent: SessionIntent): boolean {
  switch (intent.kind) {
    case "send_prompt":
      return intent.deliveryState === "waiting_for_session";
    case "update_config":
    case "resolve_interaction":
    case "edit_pending_prompt":
    case "delete_pending_prompt":
      return intent.status === "queued";
  }
}

function isIntentBlockingDispatch(intent: SessionIntent): boolean {
  switch (intent.kind) {
    case "send_prompt":
      return intent.deliveryState === "preparing"
        || intent.deliveryState === "dispatching"
        || intent.deliveryState === "unknown_after_dispatch";
    case "update_config":
    case "resolve_interaction":
    case "edit_pending_prompt":
    case "delete_pending_prompt":
      return intent.status === "preparing" || intent.status === "dispatching";
  }
}

function pendingConfigChangeFromIntent(
  intent: SessionUpdateConfigIntent,
): PendingSessionConfigChange | null {
  if (intent.status === "queued" || intent.status === "preparing" || intent.status === "dispatching") {
    return {
      rawConfigId: intent.configId,
      value: intent.value,
      status: intent.status === "queued" ? "queued" : "submitting",
      mutationId: Number.NaN,
    };
  }
  if (intent.status === "accepted" && intent.applyState === "queued") {
    return {
      rawConfigId: intent.configId,
      value: intent.value,
      status: "queued",
      mutationId: Number.NaN,
    };
  }
  return null;
}

function isActivePendingPromptMutationIntent(
  intent: SessionIntent,
): intent is Extract<SessionIntent, { kind: "edit_pending_prompt" | "delete_pending_prompt" }> {
  if (intent.kind !== "edit_pending_prompt" && intent.kind !== "delete_pending_prompt") {
    return false;
  }
  return intent.status === "queued"
    || intent.status === "preparing"
    || intent.status === "dispatching"
    || intent.status === "accepted";
}
