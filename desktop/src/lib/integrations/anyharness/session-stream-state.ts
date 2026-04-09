import {
  createTranscriptState,
  reduceEvent,
  reduceEvents,
} from "@anyharness/sdk";
import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";

export interface PendingUserPromptState {
  text: string;
  timestamp: string;
}

export interface SessionStreamState {
  events: SessionEventEnvelope[];
  transcript: TranscriptState;
  pendingUserPrompt: PendingUserPromptState | null;
}

export type StreamEnvelopeApplyResult =
  | { status: "duplicate"; state: SessionStreamState }
  | { status: "gap"; state: SessionStreamState }
  | { status: "applied"; state: SessionStreamState };

export function replaySessionHistory(
  sessionId: string,
  events: SessionEventEnvelope[],
  pendingUserPrompt: PendingUserPromptState | null,
): SessionStreamState {
  const transcript =
    events.length > 0
      ? reduceEvents(events, sessionId, { replayMode: true })
      : createTranscriptState(sessionId);
  return {
    events: [...events],
    transcript,
    pendingUserPrompt: events.some(hasUserMessageEvent) ? null : pendingUserPrompt,
  };
}

export function appendHistoryTail(
  state: SessionStreamState,
  events: SessionEventEnvelope[],
): { applied: boolean; state: SessionStreamState } {
  let nextState = state;
  let applied = false;

  for (const envelope of events) {
    if (envelope.seq <= nextState.transcript.lastSeq) {
      continue;
    }
    applied = true;
    nextState = {
      events: [...nextState.events, envelope],
      transcript: reduceEvent(nextState.transcript, envelope, { replayMode: true }),
      pendingUserPrompt: hasUserMessageEvent(envelope) ? null : nextState.pendingUserPrompt,
    };
  }

  return { applied, state: nextState };
}

export function applyStreamEnvelope(
  state: SessionStreamState,
  envelope: SessionEventEnvelope,
): StreamEnvelopeApplyResult {
  const lastSeq = state.transcript.lastSeq;
  if (envelope.seq <= lastSeq) {
    return { status: "duplicate", state };
  }
  if (envelope.seq > lastSeq + 1) {
    return { status: "gap", state };
  }

  return {
    status: "applied",
    state: {
      events: [...state.events, envelope],
      transcript: reduceEvent(state.transcript, envelope),
      pendingUserPrompt: hasUserMessageEvent(envelope) ? null : state.pendingUserPrompt,
    },
  };
}

function hasUserMessageEvent(envelope: SessionEventEnvelope): boolean {
  return (
    (envelope.event.type === "item_started" || envelope.event.type === "item_completed")
    && envelope.event.item.kind === "user_message"
  );
}
