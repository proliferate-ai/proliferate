/**
 * Shared durable-sink integrity core.
 *
 * Every DURABLE EvidenceSink (the canonical runner sink plus world-local
 * writers like Tier 2's and self-host's) delegates here so the integrity
 * semantics exist exactly once:
 *  - reserved sink-owned fields can never be supplied by callers;
 *  - payloads are materialized to their exact JSON-safe persisted form
 *    (applying toJSON) BEFORE forbidden-key screening and hashing;
 *  - append returns the ref of exactly the persisted envelope;
 *  - append after finalize throws;
 *  - finalize publishes via atomic NO-REPLACE hard-link (wx temp + fsync +
 *    link(2) + dir fsync) with guaranteed temp cleanup — racing publishers
 *    cannot replace the winner.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, linkSync, openSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";

import type { AppendedEventRef } from "../contracts/evidence.js";
import { proofEventDigest } from "../contracts/proof.js";

/** Envelope fields the sink owns; caller payloads may never supply them. */
export const RESERVED_ENVELOPE_KEYS = ["eventId", "sequence", "runId", "shardId", "at"] as const;

export interface DurableCoreOptions {
  readonly runId: string;
  readonly shardId: string;
  readonly eventsPath: string;
  readonly finalPath: string;
  /** Screens the MATERIALIZED value; throws to reject the write. */
  readonly screen: (materialized: unknown) => void;
  readonly now?: () => string;
  readonly eventIdFactory?: (sequence: number) => string;
}

export class DurableEvidenceCore {
  private sequence = 0;
  private finalized = false;
  private readonly now: () => string;
  private readonly eventIdFactory: (sequence: number) => string;

  constructor(private readonly opts: DurableCoreOptions) {
    this.now = opts.now ?? (() => new Date().toISOString());
    this.eventIdFactory = opts.eventIdFactory ?? (() => randomUUID());
  }

  /** Materialize -> reserved-key check -> screen -> envelope -> persist -> ref. */
  appendLine(event: Readonly<Record<string, unknown>>): AppendedEventRef {
    if (this.finalized) {
      throw new Error(
        `evidence for ${this.opts.runId}/${this.opts.shardId} is finalized; no further appends`,
      );
    }
    for (const key of RESERVED_ENVELOPE_KEYS) {
      if (key in event) {
        throw new Error(`evidence payload may not supply sink-owned field "${key}"`);
      }
    }
    const materialized = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    this.opts.screen(materialized);
    this.sequence += 1;
    const envelope = {
      eventId: this.eventIdFactory(this.sequence),
      sequence: this.sequence,
      runId: this.opts.runId,
      shardId: this.opts.shardId,
      at: this.now(),
      ...materialized,
    };
    appendFileSync(this.opts.eventsPath, `${JSON.stringify(envelope)}\n`, { encoding: "utf8" });
    return { eventId: envelope.eventId, sequence: envelope.sequence, digest: proofEventDigest(envelope) };
  }

  /** Materialize -> screen -> atomic NO-REPLACE publication. */
  finalizeDocument(document: object, describe: string): void {
    if (this.finalized || existsSync(this.opts.finalPath)) {
      throw new Error(`evidence already finalized for ${describe}`);
    }
    const materialized = JSON.parse(JSON.stringify(document));
    this.opts.screen(materialized);
    const tmpPath = `${this.opts.finalPath}.tmp-${randomUUID()}`;
    const fd = openSync(tmpPath, "wx");
    try {
      writeSync(fd, `${JSON.stringify(materialized, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      // link(2) fails with EEXIST when the verdict exists: NO-REPLACE.
      linkSync(tmpPath, this.opts.finalPath);
    } catch (error) {
      throw new Error(
        `evidence already finalized for ${describe} (${error instanceof Error ? error.message : String(error)})`,
      );
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        // already gone
      }
    }
    const dirFd = openSync(path.dirname(this.opts.finalPath), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
    this.finalized = true;
  }
}
