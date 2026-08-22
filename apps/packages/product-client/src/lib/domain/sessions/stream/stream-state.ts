import {
  createTranscriptState,
  reduceEvent,
  reduceEventBatch,
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
  const sortedEvents = [...events].sort((a, b) => a.seq - b.seq);
  const contiguousPrefix: SessionEventEnvelope[] = [];
  let previousSeq: number | null = null;

  for (const envelope of sortedEvents) {
    // Break the run at the first hole so lastSeq never lands past missing events.
    if (previousSeq != null && envelope.seq > previousSeq + 1) {
      break;
    }
    if (previousSeq != null && envelope.seq <= previousSeq) {
      continue;
    }
    contiguousPrefix.push(envelope);
    previousSeq = envelope.seq;
  }

  const transcript =
    contiguousPrefix.length > 0
      ? reduceEvents(contiguousPrefix, sessionId, { replayMode: true })
      : createTranscriptState(sessionId);
  return {
    events: contiguousPrefix,
    transcript,
  };
}

export function appendHistoryTail(
  state: SessionStreamState,
  events: SessionEventEnvelope[],
): { applied: boolean; state: SessionStreamState } {
  const sortedEvents = [...events].sort((a, b) => a.seq - b.seq);
  let nextEvents: SessionEventEnvelope[] | null = null;
  const appliedEnvelopes: SessionEventEnvelope[] = [];
  let lastSeq = state.transcript.lastSeq;

  for (const envelope of sortedEvents) {
    if (envelope.seq <= lastSeq) {
      continue;
    }
    if (envelope.seq > lastSeq + 1) {
      break;
    }
    lastSeq = envelope.seq;
    nextEvents ??= [...state.events];
    nextEvents.push(envelope);
    appliedEnvelopes.push(envelope);
  }

  if (appliedEnvelopes.length === 0 || !nextEvents) {
    return { applied: false, state };
  }

  return {
    applied: true,
    state: {
      events: nextEvents,
      transcript: reduceEventBatch(state.transcript, appliedEnvelopes),
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
  const sortedEnvelopes = [...envelopes].sort((a, b) => a.seq - b.seq);
  let nextEvents: SessionEventEnvelope[] | null = null;
  let lastSeq = state.transcript.lastSeq;
  const appliedEnvelopes: SessionEventEnvelope[] = [];
  const duplicateEnvelopes: SessionEventEnvelope[] = [];
  let gapEnvelope: SessionEventEnvelope | null = null;
  let skippedAfterGapEnvelopes: SessionEventEnvelope[] = [];

  for (let index = 0; index < sortedEnvelopes.length; index += 1) {
    const envelope = sortedEnvelopes[index];
    if (envelope.seq <= lastSeq) {
      duplicateEnvelopes.push(envelope);
      continue;
    }
    if (envelope.seq > lastSeq + 1) {
      gapEnvelope = envelope;
      skippedAfterGapEnvelopes = sortedEnvelopes.slice(index + 1);
      break;
    }

    nextEvents ??= [...state.events];
    nextEvents.push(envelope);
    lastSeq = envelope.seq;
    appliedEnvelopes.push(envelope);
  }

  return {
    state: nextEvents
      ? {
        events: nextEvents,
        transcript: reduceEventBatch(state.transcript, appliedEnvelopes),
      }
      : state,
    appliedEnvelopes,
    duplicateEnvelopes,
    gapEnvelope,
    skippedAfterGapEnvelopes,
  };
}
