import {
  createTranscriptState,
  reduceEvent,
  reduceEvents,
} from "@anyharness/sdk";
import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";

export interface SessionStreamState {
  events: SessionEventEnvelope[];
  transcript: TranscriptState;
}

export type StreamEnvelopeApplyResult =
  | { status: "duplicate"; state: SessionStreamState }
  | { status: "gap"; state: SessionStreamState }
  | { status: "applied"; state: SessionStreamState };

export function replaySessionHistory(
  sessionId: string,
  events: SessionEventEnvelope[],
): SessionStreamState {
  const transcript =
    events.length > 0
      ? reduceEvents(events, sessionId, { replayMode: true })
      : createTranscriptState(sessionId);
  return {
    events: [...events],
    transcript,
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
    },
  };
}
