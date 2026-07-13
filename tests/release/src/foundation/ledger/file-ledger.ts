/**
 * File-backed CleanupLedger (durable JSONL).
 *
 * Every external resource is appended to durable run output the moment it is
 * created and BEFORE it is handed to any other operation. The on-disk format is
 * an append-only event log: one JSON object per line, either a `register` event
 * or a `transition` event. State is folded from the log, so a crash mid-run
 * leaves a replayable record and every transition is persisted atomically (a
 * single sub-PIPE_BUF append).
 *
 * Implements the frozen contracts/cleanup.ts CleanupLedger interface. Entries
 * carry only safe identity — the durable-write path rejects any credential-
 * shaped key (defense in depth around the forbidden-key policy).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { CleanupEntry, CleanupLedger, CleanupState } from "../contracts/cleanup.js";
import { findForbiddenKey } from "../preflight/redaction.js";

type RegisterEvent = {
  readonly type: "register";
  readonly sequence: number;
  readonly entry: Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError">;
  readonly at: string;
};

type TransitionEvent = {
  readonly type: "transition";
  readonly sequence: number;
  readonly state: CleanupState;
  readonly error: string | null;
  readonly at: string;
};

type LedgerEvent = RegisterEvent | TransitionEvent;

export interface FileCleanupLedgerOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

export class FileCleanupLedger implements CleanupLedger {
  private readonly filePath: string;
  private readonly now: () => string;
  private nextSequence = 0;

  constructor(filePath: string, options: FileCleanupLedgerOptions = {}) {
    this.filePath = filePath;
    this.now = options.now ?? (() => new Date().toISOString());
    mkdirSync(path.dirname(filePath), { recursive: true });
    // On (re)open, advance the sequence counter past any existing register events
    // so a replay in the same file never collides sequence numbers.
    this.nextSequence = this.readEvents().reduce(
      (max, event) => (event.type === "register" ? Math.max(max, event.sequence + 1) : max),
      0,
    );
  }

  async register(
    entry: Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError">,
  ): Promise<number> {
    const forbidden = findForbiddenKey(entry as unknown);
    if (forbidden) {
      throw new Error(`cleanup ledger rejects credential-shaped key in entry: ${forbidden}`);
    }
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    const event: RegisterEvent = { type: "register", sequence, entry, at: this.now() };
    this.appendEvent(event);
    return sequence;
  }

  async transition(sequence: number, state: CleanupState, error?: string): Promise<void> {
    const event: TransitionEvent = {
      type: "transition",
      sequence,
      state,
      error: error ?? null,
      at: this.now(),
    };
    this.appendEvent(event);
  }

  async entries(): Promise<readonly CleanupEntry[]> {
    return this.foldEntries();
  }

  /** Synchronous fold — also usable by replay before the async surface is wired. */
  foldEntries(): CleanupEntry[] {
    const bySequence = new Map<number, CleanupEntry>();
    for (const event of this.readEvents()) {
      if (event.type === "register") {
        bySequence.set(event.sequence, {
          sequence: event.sequence,
          ...event.entry,
          state: "registered",
          attempts: 0,
          registeredAt: event.at,
          updatedAt: event.at,
          lastError: null,
        });
        continue;
      }
      const current = bySequence.get(event.sequence);
      if (!current) continue; // transition for an unknown sequence: ignore defensively
      bySequence.set(event.sequence, {
        ...current,
        state: event.state,
        // "cleaning" marks the start of an attempt; count attempts by cleaning transitions.
        attempts: event.state === "cleaning" ? current.attempts + 1 : current.attempts,
        updatedAt: event.at,
        lastError: event.state === "failed" ? event.error : current.lastError,
      });
    }
    return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
  }

  private appendEvent(event: LedgerEvent): void {
    // A single append of a sub-PIPE_BUF line is atomic on POSIX; the trailing
    // newline framing means a torn final write is discarded on read.
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
  }

  private readEvents(): LedgerEvent[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, "utf8");
    const events: LedgerEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        events.push(JSON.parse(trimmed) as LedgerEvent);
      } catch {
        // A torn last line from an interrupted write is ignored; earlier events
        // remain a valid, replayable record.
      }
    }
    return events;
  }
}

/** Open an existing ledger file for replay (cleanup-by-run). */
export function openLedger(filePath: string, options: FileCleanupLedgerOptions = {}): FileCleanupLedger {
  return new FileCleanupLedger(filePath, options);
}
