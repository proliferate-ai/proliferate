/**
 * Minimal append-only JSONL EvidenceSink for the self-host world's standalone
 * vertical slice. Same rationale as `local-ledger.ts`: the shared foundation
 * runner owns the eventual sink every world plugs into; until it is merged
 * into this branch, this gives the self-host provisioner and its scenario
 * actions a real, durable implementation of the frozen `EvidenceSink`
 * contract (`../../contracts/evidence.ts`) with the redaction guarantee that
 * contract requires: no payload containing a key matched by the redaction
 * policy is ever written.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { AppendedEventRef, EvidenceSink, RunEvidence } from "../../contracts/evidence.js";
import { DurableEvidenceCore } from "../../evidence/durable-core.js";

/** Key names whose values are never written, regardless of nesting depth. */
const REDACTED_KEY_PATTERN = /token|secret|password|api[_-]?key|credential|refresh|bearer/i;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : scrub(v);
    }
    return out;
  }
  return value;
}

export class LocalJsonlEvidenceSink implements EvidenceSink {
  private readonly filePath: string;
  private core: DurableEvidenceCore | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Lazy: the directory may not exist until first use. */
  private ensureCore(): DurableEvidenceCore {
    if (!this.core) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.core = new DurableEvidenceCore({
        runId: "self-host-local",
        shardId: "shard-1-of-1",
        eventsPath: this.filePath,
        finalPath: this.filePath.replace(/\.jsonl$/, "") + ".final.json",
        // This sink SCRUBS (replaces secret-shaped values) rather than
        // rejecting: it is a diagnostic local writer. The scrub runs on the
        // materialized value inside the screen hook by mutating a copy is
        // not possible, so scrub before delegation instead (see append).
        screen: () => {},
      });
    }
    return this.core;
  }

  async append(event: Readonly<Record<string, unknown>>): Promise<AppendedEventRef> {
    // Scrub BEFORE delegation so the core materializes + persists the
    // scrubbed value and the returned digest matches the persisted line.
    return this.ensureCore().appendLine(scrub(event) as Record<string, unknown>);
  }

  async finalize(evidence: RunEvidence): Promise<void> {
    this.ensureCore().finalizeDocument(
      scrub(evidence as unknown as Record<string, unknown>) as object,
      `${evidence.run.runId}/${evidence.shard.shardId}`,
    );
  }
}
