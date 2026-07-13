/**
 * Minimal file-backed CleanupLedger + destructor runner for the self-host
 * world's standalone vertical slice.
 *
 * The shared foundation runner (a sibling workstream, not yet merged into
 * this branch) owns the eventual `ledger/reconcile.ts` implementation every
 * world will plug into. Until that lands, this module gives the self-host
 * provisioner and its scenario actions a real, durable implementation of the
 * frozen `CleanupLedger` contract (`../../contracts/cleanup.ts`) so this
 * world can be exercised end to end on its own. It mirrors that contract's
 * semantics exactly (register before use, reverse-order reconcile, continue
 * through independent failures, idempotent replay) so swapping in the shared
 * implementation later is a drop-in change, not a redesign.
 *
 * Durability: every register/transition call rewrites the whole ledger file
 * atomically (temp file + rename) before returning. For the handful of
 * resources one self-host run creates (key pair, security group, instance,
 * local runtime process) this is simple and correct; a high-volume world
 * would want append-only writes instead.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  CleanupEntry,
  CleanupExecutor,
  CleanupLedger,
  CleanupReconciliation,
  CleanupState,
} from "../../contracts/cleanup.js";

/** Thrown by a destructor to signal the resource was already gone (idempotent replay). */
export class ResourceAlreadyAbsentError extends Error {
  constructor(message = "resource already absent") {
    super(message);
    this.name = "ResourceAlreadyAbsentError";
  }
}

export class LocalFileLedger implements CleanupLedger {
  private readonly filePath: string;
  private stored: CleanupEntry[] = [];
  private readonly destructors = new Map<number, CleanupExecutor>();
  private nextSequence = 1;
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { entries: CleanupEntry[]; nextSequence: number };
      this.stored = parsed.entries;
      this.nextSequence = parsed.nextSequence;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify({ entries: this.stored, nextSequence: this.nextSequence }, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }

  async register(
    entry: Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError">,
  ): Promise<number> {
    await this.ensureLoaded();
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    const now = new Date().toISOString();
    const record: CleanupEntry = {
      ...entry,
      sequence,
      state: "registered",
      attempts: 0,
      registeredAt: now,
      updatedAt: now,
      lastError: null,
    };
    this.stored.push(record);
    await this.persist();
    return sequence;
  }

  /** Convenience over `register`: also remembers the destructor for `reconcile()`. */
  async registerResource(
    entry: Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError">,
    destructor: CleanupExecutor,
  ): Promise<number> {
    const sequence = await this.register(entry);
    this.destructors.set(sequence, destructor);
    return sequence;
  }

  async transition(sequence: number, state: CleanupState, error?: string): Promise<void> {
    await this.ensureLoaded();
    const index = this.stored.findIndex((e) => e.sequence === sequence);
    if (index === -1) throw new Error(`LocalFileLedger: no entry with sequence ${sequence}`);
    const found = this.stored[index];
    this.stored[index] = {
      ...found,
      state,
      attempts: state === "cleaning" ? found.attempts + 1 : found.attempts,
      updatedAt: new Date().toISOString(),
      lastError: error ?? (state === "failed" ? found.lastError : null),
    };
    await this.persist();
  }

  async entries(): Promise<readonly CleanupEntry[]> {
    await this.ensureLoaded();
    return this.stored;
  }

  /**
   * Reconciles every registered/cleaning/failed entry in reverse registration
   * order, invoking its remembered destructor. Continues through independent
   * failures. Never mutates a `cleaned`/`absent` entry. A resumed process that
   * lost its in-memory destructors (e.g. after a crash) reports those entries
   * `failed` with an explicit "no destructor" reason rather than silently
   * dropping them; a TTL janitor remains the real backstop for genuine orphans.
   */
  async reconcile(): Promise<CleanupReconciliation> {
    await this.ensureLoaded();
    const pending = [...this.stored]
      .filter((e) => e.state === "registered" || e.state === "cleaning" || e.state === "failed")
      .sort((a, b) => b.sequence - a.sequence);

    let attempted = 0;
    let cleaned = 0;
    let alreadyAbsent = 0;
    const failed: CleanupEntry[] = [];

    for (const entry of pending) {
      attempted += 1;
      const destructor = this.destructors.get(entry.sequence);
      if (!destructor) {
        await this.transition(entry.sequence, "failed", "no destructor registered in this process");
        const latest = (await this.entries()).find((e) => e.sequence === entry.sequence);
        if (latest) failed.push(latest);
        continue;
      }
      await this.transition(entry.sequence, "cleaning");
      try {
        await destructor(entry);
        await this.transition(entry.sequence, "cleaned");
        cleaned += 1;
      } catch (error) {
        if (error instanceof ResourceAlreadyAbsentError) {
          await this.transition(entry.sequence, "absent");
          alreadyAbsent += 1;
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        await this.transition(entry.sequence, "failed", message);
        const latest = (await this.entries()).find((e) => e.sequence === entry.sequence);
        if (latest) failed.push(latest);
      }
    }

    const complete = failed.length === 0;
    return { attempted, cleaned, alreadyAbsent, failed, complete };
  }
}
