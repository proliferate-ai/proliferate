/**
 * Tier-2 workstream durable `EvidenceSink` (contracts/evidence.ts), now
 * DELEGATING to the shared DurableEvidenceCore so the canonical integrity
 * semantics (sink-owned envelope fields, materialized redaction, exact
 * persisted refs, append-after-finalize rejection, atomic NO-REPLACE
 * finalization) exist exactly once. This wrapper keeps the workstream's
 * key-pattern screen and its base-file path layout.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import type { AppendedEventRef, EvidenceSink, RunEvidence } from "../../../contracts/evidence.js";
import { DurableEvidenceCore } from "../../../evidence/durable-core.js";

// Defense in depth: reject anything that looks like it could carry a secret
// value, even though every caller in this codebase is expected to have
// already sanitized detail strings before appending them.
const REDACTED_KEY_PATTERN =
  /(secret|password|refresh_token|access_token|api[_-]?key|private[_-]?key|webhook[_-]?secret|authorization)/i;

function assertNoRedactedKeys(value: unknown, pathSoFar: string): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRedactedKeys(entry, `${pathSoFar}[${index}]`));
    return;
  }
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEY_PATTERN.test(key)) {
      throw new Error(
        `JsonlEvidenceSink: refusing to persist a payload with a redaction-policy-matched key "${pathSoFar}.${key}" — evidence must carry only sanitized detail, never raw credentials`,
      );
    }
    assertNoRedactedKeys(entryValue, `${pathSoFar}.${key}`);
  }
}

export class JsonlEvidenceSink implements EvidenceSink {
  readonly eventsPath: string;
  readonly finalPath: string;
  private readonly core: DurableEvidenceCore;

  /**
   * Requires the REAL run/shard identity — there are no defaults: a durable
   * qualification-capable sink must never stamp evidence with a placeholder
   * identity. (Tests needing a throwaway identity must name one explicitly.)
   */
  constructor(baseFilePath: string, runId: string, shardId: string) {
    this.eventsPath = `${baseFilePath}.events.jsonl`;
    this.finalPath = `${baseFilePath}.final.json`;
    mkdirSync(path.dirname(baseFilePath), { recursive: true });
    this.core = new DurableEvidenceCore({
      runId,
      shardId,
      eventsPath: this.eventsPath,
      finalPath: this.finalPath,
      screen: (materialized) => assertNoRedactedKeys(materialized, "$"),
    });
  }

  async append(event: Readonly<Record<string, unknown>>): Promise<AppendedEventRef> {
    return this.core.appendLine(event);
  }

  async finalize(evidence: RunEvidence): Promise<void> {
    this.core.finalizeDocument(evidence, `${evidence.run.runId}/${evidence.shard.shardId}`);
  }
}
