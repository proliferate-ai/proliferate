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

export interface StreamEnvelopeBatchApplyResult {
  state: SessionStreamState;
  appliedEnvelopes: SessionEventEnvelope[];
  duplicateEnvelopes: SessionEventEnvelope[];
  gapEnvelope: SessionEventEnvelope | null;
  skippedAfterGapEnvelopes: SessionEventEnvelope[];
}

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
  let nextEvents: SessionEventEnvelope[] | null = null;
  let nextTranscript = state.transcript;
  let applied = false;

  for (const envelope of events) {
    if (envelope.seq <= nextTranscript.lastSeq) {
      continue;
    }
    applied = true;
    nextEvents ??= [...state.events];
    nextEvents.push(envelope);
    nextTranscript = reduceEvent(nextTranscript, envelope);
  }

  if (!applied || !nextEvents) {
    return { applied: false, state };
  }

  return {
    applied: true,
    state: {
      events: nextEvents,
      transcript: nextTranscript,
    },
  };
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

export function applyStreamEnvelopeBatch(
  state: SessionStreamState,
  envelopes: SessionEventEnvelope[],
): StreamEnvelopeBatchApplyResult {
  let nextEvents: SessionEventEnvelope[] | null = null;
  let nextTranscript = state.transcript;
  const appliedEnvelopes: SessionEventEnvelope[] = [];
  const duplicateEnvelopes: SessionEventEnvelope[] = [];
  let gapEnvelope: SessionEventEnvelope | null = null;
  let skippedAfterGapEnvelopes: SessionEventEnvelope[] = [];

  for (let index = 0; index < envelopes.length; index += 1) {
    const envelope = envelopes[index];
    const lastSeq = nextTranscript.lastSeq;
    if (envelope.seq <= lastSeq) {
      duplicateEnvelopes.push(envelope);
      continue;
    }
    if (envelope.seq > lastSeq + 1) {
      gapEnvelope = envelope;
      skippedAfterGapEnvelopes = envelopes.slice(index + 1);
      break;
    }

    nextEvents ??= [...state.events];
    nextEvents.push(envelope);
    nextTranscript = reduceEvent(nextTranscript, envelope);
    appliedEnvelopes.push(envelope);
  }

  return {
    state: nextEvents
      ? {
        events: nextEvents,
        transcript: nextTranscript,
      }
      : state,
    appliedEnvelopes,
    duplicateEnvelopes,
    gapEnvelope,
    skippedAfterGapEnvelopes,
  };
}
