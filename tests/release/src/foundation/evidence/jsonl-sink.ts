/**
 * JSONL-backed EvidenceSink.
 *
 * Intermediate observations (readiness, attempts, ledger events) append to
 * `<outputDir>/<runId>/<shardId>/events.jsonl`. The single immutable final
 * document is written once to `.../evidence.json`; a second `finalize` throws.
 * Every payload is screened against the forbidden-key policy so a misbehaving
 * collector cannot smuggle a credential-shaped key into immutable evidence.
 *
 * Implements the frozen contracts/evidence.ts EvidenceSink interface.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { EvidenceSink, RunEvidence } from "../contracts/evidence.js";
import { findForbiddenKey } from "../preflight/redaction.js";

export interface JsonlEvidenceSinkOptions {
  now?: () => string;
}

export class JsonlEvidenceSink implements EvidenceSink {
  readonly dir: string;
  readonly eventsPath: string;
  readonly evidencePath: string;
  private finalized = false;
  private readonly now: () => string;

  constructor(outputDir: string, runId: string, shardId: string, options: JsonlEvidenceSinkOptions = {}) {
    this.dir = path.join(outputDir, runId, shardId);
    this.eventsPath = path.join(this.dir, "events.jsonl");
    this.evidencePath = path.join(this.dir, "evidence.json");
    this.now = options.now ?? (() => new Date().toISOString());
    mkdirSync(this.dir, { recursive: true });
  }

  async append(event: Readonly<Record<string, unknown>>): Promise<void> {
    const forbidden = findForbiddenKey(event);
    if (forbidden) {
      throw new Error(`evidence sink rejects credential-shaped key: ${forbidden}`);
    }
    const line = JSON.stringify({ at: this.now(), ...event });
    appendFileSync(this.eventsPath, `${line}\n`, { encoding: "utf8" });
  }

  async finalize(evidence: RunEvidence): Promise<void> {
    if (this.finalized || existsSync(this.evidencePath)) {
      throw new Error(`evidence already finalized for ${evidence.run.runId}/${evidence.shard.shardId}`);
    }
    const forbidden = findForbiddenKey(evidence);
    if (forbidden) {
      throw new Error(`evidence sink rejects credential-shaped key: ${forbidden}`);
    }
    writeFileSync(this.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8" });
    this.finalized = true;
  }
}
