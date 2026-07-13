/**
 * Engine-owned scoped proof recorder.
 *
 * Handed to collectors through CellExecutionContext. Each `pass()` appends a
 * typed proof-event envelope — bound to run/shard/cell/attempt/assertion —
 * through the run's EvidenceSink and records the canonical digest of exactly
 * what was appended. The ENGINE derives the receipt from these records after
 * the collector returns; collector code can neither construct nor forge a
 * receipt, and merely returning success records nothing.
 */

import type { AttemptIdentity } from "../contracts/identity.js";
import type { EvidenceSink } from "../contracts/evidence.js";
import type { ProofEventRef } from "../contracts/proof.js";
import { proofEventDigest } from "../contracts/proof.js";

export interface ProofRecorder {
  /** Records one passed assertion with a sanitized observation string. */
  pass(assertionId: string, observation: string): Promise<void>;
}

export class ScopedProofRecorder implements ProofRecorder {
  private readonly refs: ProofEventRef[] = [];
  private sealed = false;

  constructor(
    private readonly evidence: EvidenceSink,
    private readonly attempt: AttemptIdentity,
    private readonly redact: (value: string) => string,
    private readonly now: () => string,
  ) {}

  async pass(assertionId: string, observation: string): Promise<void> {
    if (this.sealed) {
      throw new Error(
        `proof recorder for attempt ${this.attempt.attemptId} is sealed; a collector cannot record assertions after returning`,
      );
    }
    const envelope = {
      event: "proof-assertion-pass",
      runId: this.attempt.runId,
      shardId: this.attempt.shardId,
      cellKey: this.attempt.cellKey,
      attemptId: this.attempt.attemptId,
      assertionId,
      observation: this.redact(observation),
      recordedAt: this.now(),
    };
    await this.evidence.append(envelope);
    this.refs.push({ assertionId, eventDigest: proofEventDigest(envelope) });
  }

  /** Engine-only: stops further recording and returns what was recorded. */
  seal(): readonly ProofEventRef[] {
    this.sealed = true;
    return [...this.refs];
  }
}
