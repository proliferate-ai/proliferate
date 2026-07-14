/**
 * The durable, run-owned cleanup ledger (spec "Cleanup and failure behavior").
 * Every resource is written to the ledger BEFORE it is created, using a
 * two-phase intent → acquired record so the safe provider identity is added as
 * soon as creation returns. The normal `finally` path marks each entry
 * reconciled; a replay-by-run command safely retries unfinished entries, and a
 * bounded TTL recovery command finds interrupted runs — all without touching
 * another run's resources.
 *
 * Locally the record is an atomic mode-`0600` file; in Actions the same record
 * is mirrored to a qualification-only S3 prefix so it survives complete
 * hosted-runner loss. This is only the first real local-world consumer, not a
 * generic provider framework: E2B/AWS resource kinds are added later.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** The resource kinds this first local-world consumer registers. */
export type CleanupResourceKind =
  | "litellm_virtual_key"
  | "litellm_user"
  | "litellm_team"
  | "browser_context"
  | "browser"
  | "renderer_process"
  | "anyharness_process"
  | "server_container"
  | "postgres_container"
  | "redis_container"
  | "docker_network"
  | "runtime_home"
  | "repository_clone"
  | "extracted_artifacts"
  | "run_directory"
  | "port_registration";

export type CleanupPhase = "intent" | "acquired" | "reconciled";

export interface CleanupLedgerEntry {
  entryId: string;
  kind: CleanupResourceKind;
  phase: CleanupPhase;
  /** Safe provider identity (container id, alias, path…) added on acquire. */
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Optional S3 mirror used only in Actions (qualification-only prefix). */
export interface CleanupLedgerMirror {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

export interface OpenCleanupLedgerOptions {
  runDir: string;
  runId: string;
  shardId: string;
  mirror?: CleanupLedgerMirror;
  now?: () => Date;
}

/**
 * A live ledger for one run. Registration order is preserved; cleanup replays
 * in reverse. All mutations are atomically persisted (0600 file rewrite +
 * optional mirror) before returning.
 */
export interface CleanupLedger {
  readonly ledgerId: string;
  /** Persists an `intent` record before the resource is created. */
  registerIntent(kind: CleanupResourceKind, entryId: string): Promise<CleanupLedgerEntry>;
  /** Attaches the safe provider identity once creation returns. */
  markAcquired(entryId: string, providerId: string): Promise<void>;
  /** Marks an entry reconciled after its resource is released. */
  markReconciled(entryId: string): Promise<void>;
  /** All entries in registration order. */
  entries(): CleanupLedgerEntry[];
  /** Entries not yet reconciled, in reverse-registration (cleanup) order. */
  unreconciled(): CleanupLedgerEntry[];
}

/** The ledger filename inside a run directory. */
export const CLEANUP_LEDGER_FILENAME = "cleanup-ledger.json";

interface LedgerDocument {
  ledgerId: string;
  runId: string;
  shardId: string;
  createdAt: string;
  entries: CleanupLedgerEntry[];
}

/** One-way hash of the ledger id, the only ledger identity evidence carries. */
export function hashLedgerId(ledgerId: string): string {
  return createHash("sha256").update(ledgerId).digest("hex");
}

class DurableCleanupLedger implements CleanupLedger {
  constructor(
    private readonly doc: LedgerDocument,
    private readonly filePath: string,
    private readonly now: () => Date,
    private readonly mirror: CleanupLedgerMirror | undefined,
  ) {}

  get ledgerId(): string {
    return this.doc.ledgerId;
  }

  async registerIntent(kind: CleanupResourceKind, entryId: string): Promise<CleanupLedgerEntry> {
    if (this.doc.entries.some((entry) => entry.entryId === entryId)) {
      throw new Error(`Cleanup ledger already contains entry "${entryId}".`);
    }
    const stamp = this.now().toISOString();
    const entry: CleanupLedgerEntry = {
      entryId,
      kind,
      phase: "intent",
      providerId: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.doc.entries.push(entry);
    await this.persist();
    return { ...entry };
  }

  async markAcquired(entryId: string, providerId: string): Promise<void> {
    const entry = this.require(entryId);
    entry.providerId = providerId;
    entry.phase = "acquired";
    entry.updatedAt = this.now().toISOString();
    await this.persist();
  }

  async markReconciled(entryId: string): Promise<void> {
    const entry = this.require(entryId);
    entry.phase = "reconciled";
    entry.updatedAt = this.now().toISOString();
    await this.persist();
  }

  entries(): CleanupLedgerEntry[] {
    return this.doc.entries.map((entry) => ({ ...entry }));
  }

  unreconciled(): CleanupLedgerEntry[] {
    return this.doc.entries
      .filter((entry) => entry.phase !== "reconciled")
      .map((entry) => ({ ...entry }))
      .reverse();
  }

  private require(entryId: string): CleanupLedgerEntry {
    const entry = this.doc.entries.find((candidate) => candidate.entryId === entryId);
    if (!entry) {
      throw new Error(`Cleanup ledger has no entry "${entryId}".`);
    }
    return entry;
  }

  /** Persists the current document (used to write the initial empty ledger). */
  async flush(): Promise<void> {
    await this.persist();
  }

  private async persist(): Promise<void> {
    const body = JSON.stringify(this.doc, null, 2);
    // Atomic mode-0600 replace: write a sibling temp then rename over the target
    // so a crash mid-write never leaves a truncated ledger.
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, this.filePath);
    if (this.mirror) {
      // Best-effort durable mirror (Actions-only); never blocks local teardown.
      await this.mirror.put(mirrorKey(this.doc.ledgerId), body).catch(() => undefined);
    }
  }
}

function mirrorKey(ledgerId: string): string {
  return `cleanup-ledger/${encodeURIComponent(ledgerId)}.json`;
}

export async function openCleanupLedger(options: OpenCleanupLedgerOptions): Promise<CleanupLedger> {
  const now = options.now ?? (() => new Date());
  const doc: LedgerDocument = {
    ledgerId: `${options.runId}:${options.shardId}`,
    runId: options.runId,
    shardId: options.shardId,
    createdAt: now().toISOString(),
    entries: [],
  };
  const ledger = new DurableCleanupLedger(
    doc,
    path.join(options.runDir, CLEANUP_LEDGER_FILENAME),
    now,
    options.mirror,
  );
  // Persist the empty ledger immediately so an interrupted run always leaves a
  // recoverable record, even if it crashes before the first resource.
  await ledger.flush();
  return ledger;
}

/** Reloads a persisted ledger by run directory (for replay/recovery). */
export async function loadCleanupLedger(
  runDir: string,
  mirror?: CleanupLedgerMirror,
): Promise<CleanupLedger> {
  const filePath = path.join(runDir, CLEANUP_LEDGER_FILENAME);
  const raw = await readFile(filePath, "utf8");
  const doc = JSON.parse(raw) as LedgerDocument;
  if (!doc || typeof doc.ledgerId !== "string" || !Array.isArray(doc.entries)) {
    throw new Error(`Cleanup ledger at ${filePath} is malformed.`);
  }
  return new DurableCleanupLedger(doc, filePath, () => new Date(), mirror);
}

/** A single resource releaser, keyed by kind, supplied by the cleanup stack. */
export type CleanupHandler = (entry: CleanupLedgerEntry) => Promise<void>;

/**
 * Replays a run's unreconciled entries idempotently, reverse order, marking
 * each reconciled as it succeeds. Safe to retry; touches only this run.
 */
export async function replayLedger(
  ledger: CleanupLedger,
  handlers: Partial<Record<CleanupResourceKind, CleanupHandler>>,
): Promise<{ reconciled: number; failed: number }> {
  let reconciled = 0;
  let failed = 0;
  // `unreconciled()` is already reverse-registration order; replay is safe to
  // retry because each success marks the entry reconciled and drops it out.
  for (const entry of ledger.unreconciled()) {
    const handler = handlers[entry.kind];
    if (!handler) {
      // No handler for this kind on this replay — leave it unreconciled for a
      // later, better-equipped pass rather than silently dropping it.
      failed += 1;
      continue;
    }
    try {
      await handler(entry);
      await ledger.markReconciled(entry.entryId);
      reconciled += 1;
    } catch {
      failed += 1;
    }
  }
  return { reconciled, failed };
}

/**
 * Finds interrupted runs under a base directory whose ledger has unreconciled
 * entries older than `ttlMs`, for the bounded TTL recovery command.
 */
export async function recoverInterruptedRuns(params: {
  baseDir: string;
  ttlMs: number;
  now?: () => Date;
}): Promise<string[]> {
  const now = (params.now ?? (() => new Date()))().getTime();
  const interrupted: string[] = [];
  // Layout is <baseDir>/<run_id>/<shard_id>/cleanup-ledger.json.
  for (const runEntry of await readDirSafe(params.baseDir)) {
    if (!runEntry.isDirectory()) {
      continue;
    }
    const runPath = path.join(params.baseDir, runEntry.name);
    for (const shardEntry of await readDirSafe(runPath)) {
      if (!shardEntry.isDirectory()) {
        continue;
      }
      const shardPath = path.join(runPath, shardEntry.name);
      const ledgerPath = path.join(shardPath, CLEANUP_LEDGER_FILENAME);
      let doc: LedgerDocument;
      try {
        doc = JSON.parse(await readFile(ledgerPath, "utf8")) as LedgerDocument;
      } catch {
        continue; // No/invalid ledger — nothing to recover here.
      }
      const outstanding = doc.entries?.filter((entry) => entry.phase !== "reconciled") ?? [];
      if (outstanding.length === 0) {
        continue; // Fully reconciled — a clean run, not interrupted.
      }
      // Only reclaim runs whose newest unreconciled activity is past the TTL, so
      // an in-flight concurrent run is never touched.
      const newest = Math.max(...outstanding.map((entry) => Date.parse(entry.updatedAt) || 0));
      if (now - newest >= params.ttlMs) {
        interrupted.push(shardPath);
      }
    }
  }
  return interrupted.sort();
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
