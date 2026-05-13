import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
import {
  getAuthoritativeConfigValue,
} from "@/lib/domain/sessions/pending-config";
import {
  patchPromptOutboxEntry,
  removePromptOutboxEntry,
  type PromptOutboxStateShape,
} from "@/lib/domain/sessions/intents/session-intent-state";
import { isRenderableUserMessageEcho } from "@/lib/domain/sessions/intents/prompt-echo";

export function reconcileOutboxFromEnvelopes(
  state: PromptOutboxStateShape,
  clientSessionId: string,
  envelopes: readonly SessionEventEnvelope[],
): PromptOutboxStateShape {
  let nextState = state;
  for (const envelope of envelopes) {
    const event = envelope.event;
    if (event.type === "pending_prompt_added") {
      const clientPromptId = event.promptId ?? null;
      if (clientPromptId) {
        nextState = patchPromptOutboxEntry(nextState, clientPromptId, {
          clientPromptId,
          clientSessionId,
          queuedSeq: event.seq,
          placement: "queue",
          deliveryState: "accepted_queued",
          acceptedAt: envelope.timestamp,
          errorMessage: null,
        });
      }
      continue;
    }
    if (event.type === "pending_prompt_updated") {
      const clientPromptId = event.promptId ?? null;
      if (clientPromptId) {
        nextState = patchPromptOutboxEntry(nextState, clientPromptId, {
          text: event.text,
          contentParts: event.contentParts ?? [],
          queuedSeq: event.seq,
          placement: "queue",
          deliveryState: "accepted_queued",
          acceptedAt: envelope.timestamp,
        });
      }
      continue;
    }
    if (event.type === "pending_prompt_removed") {
      const clientPromptId = event.promptId ?? null;
      if (clientPromptId) {
        nextState = patchPromptOutboxEntry(nextState, clientPromptId, {
          deliveryState: event.reason === "executed" ? "echoed_tombstone" : "cancelled",
          echoedAt: event.reason === "executed" ? envelope.timestamp : null,
        });
      }
      continue;
    }
    if (event.type === "item_completed" || event.type === "item_started") {
      const clientPromptId = event.item.kind === "user_message"
        ? event.item.promptId ?? null
        : null;
      const canReplaceOutboxRow = event.type === "item_completed"
        || isRenderableUserMessageEcho(event.item);
      if (clientPromptId && canReplaceOutboxRow) {
        nextState = patchPromptOutboxEntry(nextState, clientPromptId, {
          deliveryState: "echoed_tombstone",
          echoedAt: envelope.timestamp,
          errorMessage: null,
        });
      }
      continue;
    }
    if (event.type === "config_option_update") {
      for (const intent of Object.values(nextState.entriesById)) {
        if (
          intent.kind === "update_config"
          && intent.clientSessionId === clientSessionId
          && (intent.status === "accepted" || intent.status === "dispatching" || intent.status === "queued")
          && getAuthoritativeConfigValue(event.liveConfig, intent.configId) === intent.value
        ) {
          nextState = patchPromptOutboxEntry(nextState, intent.intentId, {
            status: "reconciled",
            reconciledAt: envelope.timestamp,
            errorMessage: null,
          });
        }
      }
      continue;
    }
    if (event.type === "interaction_resolved") {
      for (const intent of Object.values(nextState.entriesById)) {
        if (
          intent.kind === "resolve_interaction"
          && intent.clientSessionId === clientSessionId
          && intent.requestId === event.requestId
          && (intent.status === "accepted" || intent.status === "dispatching" || intent.status === "queued")
        ) {
          nextState = patchPromptOutboxEntry(nextState, intent.intentId, {
            status: "reconciled",
            reconciledAt: envelope.timestamp,
            errorMessage: null,
          });
        }
      }
    }
  }
  return nextState;
}

export function pruneEchoedOutboxTombstones(
  state: PromptOutboxStateShape,
  nowMs = Date.now(),
  ttlMs = 5_000,
): PromptOutboxStateShape {
  let nextState = state;
  for (const intent of Object.values(state.entriesById)) {
    if (intent.kind !== "send_prompt") {
      continue;
    }
    const entry = intent;
    if (entry.deliveryState !== "echoed_tombstone" || !entry.echoedAt) {
      continue;
    }
    const echoedAtMs = Date.parse(entry.echoedAt);
    if (Number.isFinite(echoedAtMs) && nowMs - echoedAtMs >= ttlMs) {
      nextState = removePromptOutboxEntry(nextState, entry.clientPromptId);
    }
  }
  return nextState;
}

export function pruneEchoedOutboxTombstonesForTranscript(
  state: PromptOutboxStateShape,
  transcript: TranscriptState,
  nowMs = Date.now(),
  ttlMs = 5_000,
): PromptOutboxStateShape {
  const inProgressPromptIds = collectInProgressTurnPromptIds(transcript);
  let nextState = state;
  for (const intent of Object.values(state.entriesById)) {
    if (intent.kind !== "send_prompt") {
      continue;
    }
    const entry = intent;
    if (
      entry.deliveryState !== "echoed_tombstone"
      || !entry.echoedAt
      || inProgressPromptIds.has(entry.clientPromptId)
    ) {
      continue;
    }
    const echoedAtMs = Date.parse(entry.echoedAt);
    if (Number.isFinite(echoedAtMs) && nowMs - echoedAtMs >= ttlMs) {
      nextState = removePromptOutboxEntry(nextState, entry.clientPromptId);
    }
  }
  return nextState;
}

function collectInProgressTurnPromptIds(transcript: TranscriptState): Set<string> {
  const promptIds = new Set<string>();
  for (const turn of Object.values(transcript.turnsById)) {
    if (turn.completedAt) {
      continue;
    }
    for (const itemId of turn.itemOrder) {
      const item = transcript.itemsById[itemId];
      if (item?.kind === "user_message" && item.promptId) {
        promptIds.add(item.promptId);
      }
    }
  }
  return promptIds;
}
