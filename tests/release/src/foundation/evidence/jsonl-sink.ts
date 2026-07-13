/**
 * JSONL-backed EvidenceSink — the canonical durable implementation.
 *
 * The SINK owns event identity: every append is wrapped in a canonical
 * envelope carrying runId/shardId, a sink-assigned eventId, a monotonically
 * increasing sequence, and the sink's timestamp. `append` returns the
 * reference — id, sequence, and the canonical sha256 digest of EXACTLY the
 * persisted JSONL line's envelope — so proof refs recompute from the journal
 * and a tampered line no longer matches.
 *
 * Integrity properties:
 *  - refuses to adopt an existing run/shard journal (no silent continuation
 *    of another process's evidence);
 *  - append after finalize throws;
 *  - finalize writes the immutable document via exclusive atomic
 *    temp + fsync + rename semantics (wx create, fsync file and directory),
 *    so a crash or a concurrent check-then-write can neither replace nor
 *    truncate a verdict.
 *
 * Implements the frozen contracts/evidence.ts EvidenceSink interface.
 */

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import type { AppendedEventRef, EvidenceSink, RunEvidence } from "../contracts/evidence.js";
import { proofEventDigest } from "../contracts/proof.js";
import { findForbiddenKey } from "../preflight/redaction.js";

export interface JsonlEvidenceSinkOptions {
  now?: () => string;
  /** Injectable id factory for deterministic tests. */
  eventIdFactory?: (sequence: number) => string;
}

export class JsonlEvidenceSink implements EvidenceSink {
  readonly dir: string;
  readonly eventsPath: string;
  readonly evidencePath: string;
  private finalized = false;
  private sequence = 0;
  private readonly now: () => string;
  private readonly eventIdFactory: (sequence: number) => string;
  private readonly runId: string;
  private readonly shardId: string;

  constructor(outputDir: string, runId: string, shardId: string, options: JsonlEvidenceSinkOptions = {}) {
    this.dir = path.join(outputDir, runId, shardId);
    this.eventsPath = path.join(this.dir, "events.jsonl");
    this.evidencePath = path.join(this.dir, "evidence.json");
    this.now = options.now ?? (() => new Date().toISOString());
    this.eventIdFactory = options.eventIdFactory ?? (() => randomUUID());
    this.runId = runId;
    this.shardId = shardId;
    mkdirSync(this.dir, { recursive: true });
    // Never silently adopt another process's journal or verdict for this
    // run/shard: evidence identity is exclusive to one sink instance.
    if (existsSync(this.eventsPath)) {
      throw new Error(
        `evidence journal already exists for ${runId}/${shardId} (${this.eventsPath}); refusing to append to another run's evidence`,
      );
    }
    if (existsSync(this.evidencePath)) {
      throw new Error(
        `evidence already finalized for ${runId}/${shardId} (${this.evidencePath}); refusing to reopen`,
      );
    }
    // Claim the journal exclusively so a concurrent sink for the same
    // run/shard fails at construction, not at first append.
    const fd = openSync(this.eventsPath, "wx");
    closeSync(fd);
  }

  async append(event: Readonly<Record<string, unknown>>): Promise<AppendedEventRef> {
    if (this.finalized) {
      throw new Error(`evidence for ${this.runId}/${this.shardId} is finalized; no further appends`);
    }
    const forbidden = findForbiddenKey(event);
    if (forbidden) {
      throw new Error(`evidence sink rejects credential-shaped key: ${forbidden}`);
    }
    this.sequence += 1;
    const envelope = {
      eventId: this.eventIdFactory(this.sequence),
      sequence: this.sequence,
      runId: this.runId,
      shardId: this.shardId,
      at: this.now(),
      ...event,
    };
    appendFileSync(this.eventsPath, `${JSON.stringify(envelope)}\n`, { encoding: "utf8" });
    return {
      eventId: envelope.eventId,
      sequence: envelope.sequence,
      digest: proofEventDigest(envelope),
    };
  }

  async finalize(evidence: RunEvidence): Promise<void> {
    if (this.finalized || existsSync(this.evidencePath)) {
      throw new Error(`evidence already finalized for ${evidence.run.runId}/${evidence.shard.shardId}`);
    }
    const forbidden = findForbiddenKey(evidence);
    if (forbidden) {
      throw new Error(`evidence sink rejects credential-shaped key: ${forbidden}`);
    }
    // Exclusive atomic write: create the temp exclusively (wx), fsync the
    // bytes, rename into place, then fsync the directory so the rename is
    // durable. A crash mid-way leaves either no verdict or the complete one;
    // a racing finalize loses at the exclusive temp create or the rename.
    const tmpPath = `${this.evidencePath}.tmp-${randomUUID()}`;
    const fd = openSync(tmpPath, "wx");
    try {
      writeSync(fd, `${JSON.stringify(evidence, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(this.evidencePath)) {
      throw new Error(`evidence already finalized for ${evidence.run.runId}/${evidence.shard.shardId}`);
    }
    renameSync(tmpPath, this.evidencePath);
    const dirFd = openSync(this.dir, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
    this.finalized = true;
  }
}
