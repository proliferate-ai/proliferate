import {
  reduceEvents,
  type SessionEventEnvelope,
  type TranscriptState,
} from "@anyharness/sdk";

// Order envelopes by seq and drop duplicate seqs; the SDK reducer folds in array order.
export function orderEnvelopesBySeq(
  envelopes: readonly SessionEventEnvelope[],
): SessionEventEnvelope[] {
  const bySeq = new Map<number, SessionEventEnvelope>();
  for (const envelope of envelopes) {
    bySeq.set(envelope.seq, envelope);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

// Transport-neutral convergence point: normalize envelope order, fold via the SDK reducer.
export function reconstructTranscriptState(
  sessionId: string,
  envelopes: readonly SessionEventEnvelope[],
): TranscriptState {
  return reduceEvents(orderEnvelopesBySeq(envelopes), sessionId);
}
