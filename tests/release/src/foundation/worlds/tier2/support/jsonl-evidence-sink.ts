/**
 * Minimal durable `EvidenceSink` implementation (contracts/evidence.ts),
 * scoped to this workstream the same way `JsonlCleanupLedger` is (see that
 * file's header) — the shared runner-level evidence sink is a separate
 * workstream's concern. Persists intermediate `append()` events to one JSONL
 * file and the single final `RunEvidence` document to a sibling `.final.json`
 * file, refusing a second `finalize()` call (the contract's "exactly once per
 * run") and rejecting any payload whose keys match the redaction policy.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { EvidenceSink, RunEvidence } from "../../../contracts/evidence.js";

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
  private readonly eventsPath: string;
  private readonly finalPath: string;
  private finalized = false;

  constructor(baseFilePath: string) {
    this.eventsPath = `${baseFilePath}.events.jsonl`;
    this.finalPath = `${baseFilePath}.final.json`;
    mkdirSync(path.dirname(baseFilePath), { recursive: true });
  }

  async append(event: Readonly<Record<string, unknown>>): Promise<void> {
    assertNoRedactedKeys(event, "event");
    appendFileSync(this.eventsPath, `${JSON.stringify({ ...event, recordedAt: new Date().toISOString() })}\n`, "utf8");
  }

  async finalize(evidence: RunEvidence): Promise<void> {
    if (this.finalized) {
      throw new Error("JsonlEvidenceSink: finalize() called more than once for this run (contract requires exactly once)");
    }
    assertNoRedactedKeys(evidence, "evidence");
    if (existsSync(this.finalPath)) {
      throw new Error(`JsonlEvidenceSink: ${this.finalPath} already exists — a prior process already finalized this run`);
    }
    writeFileSync(this.finalPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    this.finalized = true;
  }
}
