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

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { EvidenceSink, RunEvidence } from "../../contracts/evidence.js";

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
  private finalized = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async append(event: Readonly<Record<string, unknown>>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...scrub(event) as object });
    await appendFile(this.filePath, `${line}\n`, "utf8");
  }

  async finalize(evidence: RunEvidence): Promise<void> {
    if (this.finalized) {
      throw new Error("LocalJsonlEvidenceSink.finalize called more than once for this run");
    }
    this.finalized = true;
    await mkdir(dirname(this.filePath), { recursive: true });
    const scrubbed = scrub(evidence as unknown as Record<string, unknown>);
    await appendFile(
      this.filePath,
      `${JSON.stringify({ ts: new Date().toISOString(), event: "final-evidence", evidence: scrubbed })}\n`,
      "utf8",
    );
    const finalPath = this.filePath.replace(/\.jsonl$/, "") + ".final.json";
    await writeFile(finalPath, JSON.stringify(scrubbed, null, 2), "utf8");
  }
}
