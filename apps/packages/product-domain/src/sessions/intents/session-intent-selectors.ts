import type {
  PendingPromptEntry,
  SessionExecutionSummary,
  SessionStatus,
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
} from "./session-intent-model";
import type { SessionIntentStateShape } from "./session-intent-state";
import { isRenderableUserMessageEcho } from "./prompt-echo";
import type {
  PendingSessionConfigChange,
  PendingSessionConfigChanges,
} from "../pending-config";

export const EMPTY_INTENT_PENDING_CONFIG_CHANGES: PendingSessionConfigChanges = {};

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
  let pendingConfigChanges: PendingSessionConfigChanges | null = null;
  for (const intent of intents) {
    if (intent.kind !== "update_config") {
      continue;
    }
    const pendingChange = pendingConfigChangeFromIntent(intent);
    if (pendingChange) {
      pendingConfigChanges ??= {};
      pendingConfigChanges[intent.configId] = pendingChange;
    }
  }
  return pendingConfigChanges ?? EMPTY_INTENT_PENDING_CONFIG_CHANGES;
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
  for (const entry of entries) {
    const isEchoed = echoedPromptIds.has(entry.clientPromptId);
    const isFailedBeforeDispatch = entry.deliveryState === "failed_before_dispatch";
    const isTerminal = isOutboxEntryTerminal(entry);
    if (isFailedBeforeDispatch && !isEchoed) {
      renderableEntries.push(entry);
      continue;
    }
    // Queue-placed entries have one owner: the composer dock's outbound list.
    // Rendering them here as well duplicates the same message in two places.
    if (entry.placement === "queue") {
      continue;
    }
    if (!isTerminal && !isEchoed) {
      renderableEntries.push(entry);
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

export function isPromptOutboxPlacementBusy(input: {
  transcript: Pick<
    TranscriptState,
    "isStreaming" | "pendingInteractions" | "pendingPrompts" | "turnOrder" | "turnsById"
  > | null | undefined;
  executionSummary?: SessionExecutionSummary | null | undefined;
  status?: SessionStatus | null | undefined;
  streamConnectionState?: "disconnected" | "connecting" | "open" | "ended" | null | undefined;
}): boolean {
  const transcript = input.transcript;
  const summaryPendingInteractions = input.executionSummary?.pendingInteractions ?? [];
  if (summaryPendingInteractions.length > 0) {
    return true;
  }
  if (input.executionSummary?.phase === "starting" || input.status === "starting") {
    return true;
  }
  const hasPotentiallyActiveStreamConnection =
    input.streamConnectionState === "connecting"
    || input.streamConnectionState === "open"
    || input.streamConnectionState === "disconnected";
  if (
    hasPotentiallyActiveStreamConnection
    && (input.executionSummary?.phase === "running" || input.status === "running")
  ) {
    return true;
  }
  if (!transcript) {
    return false;
  }
  if (transcript.isStreaming) {
    return true;
  }
  if (transcript.pendingInteractions.length > 0 || transcript.pendingPrompts.length > 0) {
    return true;
  }

  const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1] ?? null;
  const latestTurn = latestTurnId ? transcript.turnsById[latestTurnId] : null;
  return !!latestTurn && !latestTurn.completedAt;
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
    || !isOutboxEntryTerminal(entry);
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
      // Pre-dispatch "queued" is a transient store state, not a turn-blocked
      // change — surfacing it as pending-"queued" flashes the clock glyph on
      // every switch. Only accepted+applyState:"queued" below is genuinely
      // waiting on the running turn.
      status: "submitting",
      mutationId: Number.NaN,
    };
  }
  // Hold the optimistic value through `accepted` (the HTTP mutation has
  // returned) until the authoritative `config_option_update` event transitions
  // this intent to `reconciled`. Clearing at `accepted+applied` instead briefly
  // reverts the control to the not-yet-updated server value — the "switch lands
  // one behind" off-by-one. The same SSE event that reconciles the intent also
  // updates the directory `currentValue` (stream-patch), so the hand-off has no
  // gap, and the intent can't stick: reconcile only fires once the authoritative
  // value matches the requested one.
  if (intent.status === "accepted") {
    return {
      rawConfigId: intent.configId,
      value: intent.value,
      // applyState "queued" is still pending at the backend (mid-turn) → clock.
      // Otherwise the backend already applied it and we are only holding the
      // optimistic value until the live config echoes back → "settling" (no
      // indicator), so a delayed/absent echo never leaves a stuck "updating"
      // spinner. (No-op switches in particular emit no config_option_update.)
      status: intent.applyState === "queued" ? "queued" : "settling",
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
