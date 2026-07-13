/**
 * Shared durable-sink integrity core.
 *
 * Every QUALIFICATION-CAPABLE durable EvidenceSink (the canonical runner sink
 * plus world-local writers like Tier 2's and self-host's) delegates here so
 * the integrity semantics exist exactly once:
 *  - exclusive journal claiming: the core itself refuses an existing
 *    journal/verdict and claims the journal with wx, so two instances can
 *    never both write sequence 1;
 *  - reserved sink-owned fields are rejected on the RAW payload AND re-checked
 *    on the MATERIALIZED payload (toJSON applied) — and the envelope is built
 *    with authoritative fields assigned AFTER the payload spread, so even a
 *    validation regression cannot let caller data override them;
 *  - payloads are materialized to their exact JSON-safe persisted form before
 *    screening and hashing;
 *  - append returns the ref of exactly the persisted envelope;
 *  - FINALIZATION IS TERMINAL FROM THE MOMENT IT BEGINS: any finalize attempt
 *    (successful, EEXIST-lost, or failed at open/write/fsync/link/dir-fsync)
 *    seals the sink — append and retry both fail afterwards. There is no
 *    retry under the same run/shard identity.
 *  - temp cleanup runs on every failure class; an unlink failure is never
 *    silently swallowed — it is reported alongside the primary error.
 */

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import type { AppendedEventRef } from "../contracts/evidence.js";
import { proofEventDigest } from "../contracts/proof.js";

/** Envelope fields the sink owns; caller payloads may never supply them. */
export const RESERVED_ENVELOPE_KEYS = ["eventId", "sequence", "runId", "shardId", "at"] as const;

type SinkState = "open" | "sealing" | "sealed";

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
  private state: SinkState = "open";
  private readonly now: () => string;
  private readonly eventIdFactory: (sequence: number) => string;

  constructor(private readonly opts: DurableCoreOptions) {
    this.now = opts.now ?? (() => new Date().toISOString());
    this.eventIdFactory = opts.eventIdFactory ?? (() => randomUUID());
    // Exclusive claiming lives IN the core: every qualification-capable
    // durable sink gets it, and two instances can never both write seq 1.
    if (existsSync(this.opts.eventsPath)) {
      throw new Error(
        `evidence journal already exists for ${opts.runId}/${opts.shardId} (${opts.eventsPath}); refusing to append to another run's evidence`,
      );
    }
    if (existsSync(this.opts.finalPath)) {
      throw new Error(
        `evidence already finalized for ${opts.runId}/${opts.shardId} (${opts.finalPath}); refusing to reopen`,
      );
    }
    // wx: exclusive create — a concurrent core for the same paths fails here.
    const fd = openSync(this.opts.eventsPath, "wx");
    closeSync(fd);
  }

  /** Raw check -> materialize -> reserved RE-check -> screen -> envelope -> persist -> ref. */
  appendLine(event: Readonly<Record<string, unknown>>): AppendedEventRef {
    if (this.state !== "open") {
      throw new Error(
        `evidence for ${this.opts.runId}/${this.opts.shardId} is ${this.state}; no further appends (finalization is terminal from the moment it begins)`,
      );
    }
    for (const key of RESERVED_ENVELOPE_KEYS) {
      if (key in event) {
        throw new Error(`evidence payload may not supply sink-owned field "${key}"`);
      }
    }
    // Materialize the EXACT JSON-safe persisted value (applies toJSON) …
    const materialized = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    // … then RE-check reserved keys: a toJSON can INTRODUCE reserved fields
    // that were absent from the raw payload.
    for (const key of RESERVED_ENVELOPE_KEYS) {
      if (key in materialized) {
        throw new Error(
          `evidence payload may not supply sink-owned field "${key}" (introduced during serialization)`,
        );
      }
    }
    this.opts.screen(materialized);
    this.sequence += 1;
    // Authoritative fields are assigned AFTER the payload spread: even if
    // both checks above regressed, the sink's values win the merge.
    const envelope = {
      ...materialized,
      eventId: this.eventIdFactory(this.sequence),
      sequence: this.sequence,
      runId: this.opts.runId,
      shardId: this.opts.shardId,
      at: this.now(),
    };
    appendFileSync(this.opts.eventsPath, `${JSON.stringify(envelope)}\n`, { encoding: "utf8" });
    return { eventId: envelope.eventId, sequence: envelope.sequence, digest: proofEventDigest(envelope) };
  }

  /**
   * Materialize -> screen -> atomic NO-REPLACE publication. Terminal: the
   * sink seals when this method STARTS; every failure class (screen, open,
   * write, fsync, link EEXIST, dir fsync) leaves the sink sealed and appends
   * rejected. Temp cleanup runs on every path; an unlink failure is reported
   * alongside the primary error, never swallowed.
   */
  finalizeDocument(document: object, describe: string): void {
    if (this.state !== "open") {
      throw new Error(
        `evidence already ${this.state === "sealed" ? "finalized" : "finalizing"} for ${describe}; a finalize attempt is terminal and cannot be retried under the same run/shard identity`,
      );
    }
    // Terminal from the moment finalization begins.
    this.state = "sealing";
    try {
      this.publish(document, describe);
      this.state = "sealed";
    } catch (error) {
      this.state = "sealed";
      throw error;
    }
  }

  private publish(document: object, describe: string): void {
    if (existsSync(this.opts.finalPath)) {
      throw new Error(`evidence already finalized for ${describe}`);
    }
    const materialized = JSON.parse(JSON.stringify(document));
    this.opts.screen(materialized);

    const tmpPath = `${this.opts.finalPath}.tmp-${randomUUID()}`;
    let tmpCreated = false;
    let primary: unknown = null;
    try {
      const fd = openSync(tmpPath, "wx");
      tmpCreated = true;
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
      }
      const dirFd = openSync(path.dirname(this.opts.finalPath), "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      if (tmpCreated) {
        try {
          unlinkSync(tmpPath);
        } catch (cleanupError) {
          const cleanupMessage =
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          if (primary) {
            // Preserve BOTH: the primary failure and the cleanup failure.
            const primaryMessage = primary instanceof Error ? primary.message : String(primary);
            throw new Error(
              `${primaryMessage}; ADDITIONALLY temp cleanup failed: ${cleanupMessage} (${tmpPath})`,
            );
          }
          throw new Error(`evidence temp cleanup failed after publication: ${cleanupMessage} (${tmpPath})`);
        }
      }
    }
  }
}
