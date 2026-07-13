/**
 * Local, in-memory implementations of the frozen CleanupLedger and EvidenceSink
 * contracts. These are runner/test infrastructure for driving the
 * managed-cloud-upgrade world outside a full CI harness — they are NOT the
 * frozen contract and never weaken it. Redaction is enforced at write time:
 * a payload carrying a secret-shaped key is rejected, not silently persisted.
 */

import type {
  CleanupEntry,
  CleanupExecutor,
  CleanupLedger,
  CleanupReconciliation,
  CleanupState,
} from "../../contracts/cleanup.js";
import type { EvidenceSink, RunEvidence } from "../../contracts/evidence.js";

/** Keys that must never appear in a ledger entry or evidence payload. */
const SECRET_KEY = /(secret|password|passwd|token|bearer|authorization|private[_-]?key|access[_-]?key|api[_-]?key|refresh)/i;

function assertNoSecretKeys(payload: Readonly<Record<string, unknown>>, where: string): void {
  for (const key of Object.keys(payload)) {
    if (SECRET_KEY.test(key)) {
      throw new Error(`refusing to persist ${where}: key "${key}" is secret-shaped (names only, never values)`);
    }
  }
}

/** Mutable internal row; `CleanupEntry` views are produced on read. */
interface LedgerRow {
  entry: {
    sequence: number;
    runId: string;
    shardId: string;
    provider: string;
    resourceType: string;
    resourceId: string;
    owningWorld: string;
    state: CleanupState;
    attempts: number;
    registeredAt: string;
    updatedAt: string;
    lastError: string | null;
  };
  executor: CleanupExecutor | null;
}

export class InMemoryCleanupLedger implements CleanupLedger {
  private readonly rows: LedgerRow[] = [];

  async register(
    entry: Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError">,
    executor?: CleanupExecutor,
  ): Promise<number> {
    assertNoSecretKeys(entry as unknown as Record<string, unknown>, "cleanup entry");
    const sequence = this.rows.length;
    const now = new Date().toISOString();
    this.rows.push({
      entry: {
        ...entry,
        sequence,
        state: "registered",
        attempts: 0,
        registeredAt: now,
        updatedAt: now,
        lastError: null,
      },
      executor: executor ?? null,
    });
    return sequence;
  }

  async transition(sequence: number, state: CleanupState, error?: string): Promise<void> {
    const row = this.rows[sequence];
    if (row === undefined) throw new Error(`cleanup sequence ${sequence} not registered`);
    row.entry.state = state;
    row.entry.attempts += state === "cleaning" ? 1 : 0;
    row.entry.updatedAt = new Date().toISOString();
    row.entry.lastError = error ?? null;
  }

  async entries(): Promise<readonly CleanupEntry[]> {
    return this.rows.map((row) => ({ ...row.entry }));
  }

  /**
   * Reconcile in reverse registration order, continuing through independent
   * failures and aggregating them. `complete` is true only when no entry
   * remains in registered/cleaning/failed state.
   */
  async reconcile(): Promise<CleanupReconciliation> {
    let cleaned = 0;
    let alreadyAbsent = 0;
    const failed: CleanupEntry[] = [];
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (row.entry.state === "cleaned" || row.entry.state === "absent") continue;
      await this.transition(i, "cleaning");
      try {
        if (row.executor) await row.executor({ ...row.entry });
        await this.transition(i, "cleaned");
        cleaned += 1;
      } catch (error) {
        await this.transition(i, "failed", error instanceof Error ? error.message : String(error));
        failed.push({ ...this.rows[i].entry });
      }
    }
    const attempted = cleaned + failed.length;
    return { attempted, cleaned, alreadyAbsent, failed, complete: failed.length === 0 };
  }
}

export class InMemoryEvidenceSink implements EvidenceSink {
  readonly events: Readonly<Record<string, unknown>>[] = [];
  finalized: RunEvidence | null = null;

  async append(event: Readonly<Record<string, unknown>>): Promise<void> {
    assertNoSecretKeys(event, "evidence event");
    this.events.push(event);
  }

  async finalize(evidence: RunEvidence): Promise<void> {
    if (this.finalized !== null) throw new Error("evidence already finalized; finalize is exactly once per run");
    this.finalized = evidence;
  }
}
