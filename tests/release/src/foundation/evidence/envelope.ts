/**
 * Envelope helper for non-canonical EvidenceSink implementations (world-local
 * writers and in-memory test sinks). The canonical durable sink is
 * jsonl-sink.ts; this helper keeps the others honest about the AppendedEventRef
 * contract: sink-owned id, monotonic sequence, and a digest computed from the
 * EXACT envelope the sink persisted/stored.
 */

import { randomUUID } from "node:crypto";

import type { AppendedEventRef } from "../contracts/evidence.js";
import { proofEventDigest } from "../contracts/proof.js";

export class EnvelopeCounter {
  private sequence = 0;

  /** Wraps a payload in a sink-owned envelope and returns [envelope, ref]. */
  wrap(
    runId: string,
    shardId: string,
    event: Readonly<Record<string, unknown>>,
    at: string = new Date().toISOString(),
  ): [Record<string, unknown>, AppendedEventRef] {
    this.sequence += 1;
    const envelope = {
      eventId: randomUUID(),
      sequence: this.sequence,
      runId,
      shardId,
      at,
      ...event,
    };
    return [envelope, { eventId: envelope.eventId, sequence: envelope.sequence, digest: proofEventDigest(envelope) }];
  }
}
