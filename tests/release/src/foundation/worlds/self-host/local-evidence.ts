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
import { findForbiddenKey } from "../../preflight/redaction.js";

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
  private readonly runId: string;
  private readonly shardId: string;

  /** Requires the REAL run/shard identity — no placeholder defaults. */
  constructor(filePath: string, runId: string, shardId: string) {
    this.filePath = filePath;
    this.runId = runId;
    this.shardId = shardId;
  }

  /** Lazy: the directory may not exist until first use. */
  private ensureCore(): DurableEvidenceCore {
    if (!this.core) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.core = new DurableEvidenceCore({
        runId: this.runId,
        shardId: this.shardId,
        eventsPath: this.filePath,
        finalPath: this.filePath.replace(/\.jsonl$/, "") + ".final.json",
        // Pre-scrub replaces known secret-shaped VALUES, but the screen must
        // still inspect the MATERIALIZED value (post-toJSON) with the
        // canonical forbidden-key policy: a toJSON can introduce a
        // credential key the pre-scrub never saw.
        screen: (materialized) => {
          const forbidden = findForbiddenKey(materialized);
          if (forbidden) {
            throw new Error(`evidence sink rejects credential-shaped key: ${forbidden}`);
          }
        },
      });
    }
    return this.core;
  }

  async append(event: Readonly<Record<string, unknown>>): Promise<AppendedEventRef> {
    // Scrub BEFORE delegation so the core materializes + persists the
    // scrubbed value and the returned digest matches the persisted line; the
    // core then re-screens the materialized value (toJSON-introduced keys).
    return this.ensureCore().appendLine(scrub(event) as Record<string, unknown>);
  }

  async finalize(evidence: RunEvidence): Promise<void> {
    this.ensureCore().finalizeDocument(
      scrub(evidence as unknown as Record<string, unknown>) as object,
      `${evidence.run.runId}/${evidence.shard.shardId}`,
    );
  }
}
