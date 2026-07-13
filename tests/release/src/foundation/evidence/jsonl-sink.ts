/**
 * JSONL-backed EvidenceSink — the canonical durable implementation.
 *
 * Delegates integrity semantics to DurableEvidenceCore (evidence/durable-core.ts):
 * sink-owned envelope fields, materialized redaction, exact persisted refs,
 * append-after-finalize rejection, and atomic NO-REPLACE finalization.
 * This class additionally refuses to adopt an existing run/shard journal or
 * verdict at construction and claims the journal exclusively.
 */

import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

import type { AppendedEventRef, EvidenceSink, RunEvidence } from "../contracts/evidence.js";
import { findForbiddenKey } from "../preflight/redaction.js";
import { DurableEvidenceCore } from "./durable-core.js";

export { RESERVED_ENVELOPE_KEYS } from "./durable-core.js";

export interface JsonlEvidenceSinkOptions {
  now?: () => string;
  /** Injectable id factory for deterministic tests. */
  eventIdFactory?: (sequence: number) => string;
}

export class JsonlEvidenceSink implements EvidenceSink {
  readonly dir: string;
  readonly eventsPath: string;
  readonly evidencePath: string;
  private readonly core: DurableEvidenceCore;
  private readonly runId: string;
  private readonly shardId: string;

  constructor(outputDir: string, runId: string, shardId: string, options: JsonlEvidenceSinkOptions = {}) {
    this.dir = path.join(outputDir, runId, shardId);
    this.eventsPath = path.join(this.dir, "events.jsonl");
    this.evidencePath = path.join(this.dir, "evidence.json");
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
    this.core = new DurableEvidenceCore({
      runId,
      shardId,
      eventsPath: this.eventsPath,
      finalPath: this.evidencePath,
      screen: (materialized) => {
        const forbidden = findForbiddenKey(materialized);
        if (forbidden) {
          throw new Error(`evidence sink rejects credential-shaped key: ${forbidden}`);
        }
      },
      now: options.now,
      eventIdFactory: options.eventIdFactory,
    });
  }

  async append(event: Readonly<Record<string, unknown>>): Promise<AppendedEventRef> {
    return this.core.appendLine(event);
  }

  async finalize(evidence: RunEvidence): Promise<void> {
    this.core.finalizeDocument(evidence, `${evidence.run.runId}/${evidence.shard.shardId}`);
  }
}
