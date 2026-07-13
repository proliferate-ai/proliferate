/**
 * Minimal durable `CleanupLedger` implementation (contracts/cleanup.ts),
 * scoped to this workstream (Tier 2 world adapter + vertical slice). The
 * shared runner-level ledger implementation used by the CLI across every
 * world is a separate workstream's concern (the orchestrator/runner); this
 * one exists so the Tier2WorldProvisioner and its vertical-slice driver can
 * exercise the real frozen contract end to end without inventing a
 * throwaway ad hoc bookkeeping shape.
 *
 * Append-only JSONL file: every `register`/`transition` call appends one
 * line synchronously before resolving, so a crash mid-run leaves a durable,
 * replayable log (`entries()` folds the log deterministically). Cleanup order
 * and "later janitor success never turns a failed strict run green" are the
 * caller's responsibility (contracts/cleanup.ts) — this class only persists
 * state faithfully.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { CleanupEntry, CleanupLedger, CleanupState } from "../../../contracts/cleanup.js";

type LogLine =
  | { type: "register"; entry: CleanupEntry }
  | { type: "transition"; sequence: number; state: CleanupState; error: string | null; updatedAt: string };

export class JsonlCleanupLedger implements CleanupLedger {
  private readonly filePath: string;
  private nextSequence = 1;
  private readonly bySequence = new Map<number, CleanupEntry>();

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (existsSync(filePath)) {
      this.replay();
    }
  }

  private replay(): void {
    const raw = readFileSync(this.filePath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as LogLine;
      if (parsed.type === "register") {
        this.bySequence.set(parsed.entry.sequence, parsed.entry);
        this.nextSequence = Math.max(this.nextSequence, parsed.entry.sequence + 1);
      } else {
        const existing = this.bySequence.get(parsed.sequence);
        if (existing) {
          this.bySequence.set(parsed.sequence, {
            ...existing,
            state: parsed.state,
            updatedAt: parsed.updatedAt,
            lastError: parsed.error,
            attempts: existing.attempts + (parsed.state === "cleaning" ? 1 : 0),
          });
        }
      }
    }
  }

  private appendLine(line: LogLine): void {
    appendFileSync(this.filePath, `${JSON.stringify(line)}\n`, "utf8");
  }

  async register(
    entry: Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError">,
  ): Promise<number> {
    const sequence = this.nextSequence++;
    const now = new Date().toISOString();
    const full: CleanupEntry = {
      ...entry,
      sequence,
      state: "registered",
      attempts: 0,
      registeredAt: now,
      updatedAt: now,
      lastError: null,
    };
    this.appendLine({ type: "register", entry: full });
    this.bySequence.set(sequence, full);
    return sequence;
  }

  async transition(sequence: number, state: CleanupState, error?: string): Promise<void> {
    const existing = this.bySequence.get(sequence);
    if (!existing) {
      throw new Error(`JsonlCleanupLedger: no entry registered with sequence ${sequence}`);
    }
    const updatedAt = new Date().toISOString();
    this.appendLine({ type: "transition", sequence, state, error: error ?? null, updatedAt });
    this.bySequence.set(sequence, {
      ...existing,
      state,
      updatedAt,
      lastError: error ?? null,
      attempts: existing.attempts + (state === "cleaning" ? 1 : 0),
    });
  }

  async entries(): Promise<readonly CleanupEntry[]> {
    return [...this.bySequence.values()].sort((a, b) => a.sequence - b.sequence);
  }
}
