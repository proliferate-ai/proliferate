/**
 * Cleanup reconciliation and the CleanupRunner.
 *
 * Reconciliation runs in reverse registration order, continues through
 * independent failures, aggregates them, and persists every transition
 * atomically. It is idempotent: an executor that observes its resource is
 * already gone marks the entry `absent`, and an already-`cleaned`/`absent` entry
 * is never re-run. It is replayable after an interruption via `cleanupByRun`,
 * which folds a ledger file from disk and re-reconciles using a resolver that
 * reconstructs destructors from safe entry identity (a fresh process has no
 * in-memory executors).
 *
 * Later janitor success never turns a strict run with failed cleanup green:
 * `CleanupReconciliation.complete` is false whenever any entry remains in
 * registered/cleaning/failed state, and the runner surfaces that verbatim to
 * evaluation.
 */

import type {
  CleanupEntry,
  CleanupExecutor,
  CleanupLedger,
  CleanupReconciliation,
} from "../contracts/cleanup.js";
import { FileCleanupLedger } from "./file-ledger.js";

/** Thrown by an executor when the resource is already gone; reconcile marks `absent`. */
export class ResourceAlreadyAbsentError extends Error {
  constructor(message = "resource already absent") {
    super(message);
    this.name = "ResourceAlreadyAbsentError";
  }
}

/** Reconstructs a destructor from safe entry identity (used on crash-replay). */
export type CleanupExecutorResolver = (entry: CleanupEntry) => CleanupExecutor | null;

/** States that still need work; a `cleaned`/`absent` entry is left alone. */
function needsCleanup(state: CleanupEntry["state"]): boolean {
  return state === "registered" || state === "cleaning" || state === "failed";
}

export interface ReconcileOptions {
  /** Fallback destructor resolver for entries with no live executor (replay). */
  resolver?: CleanupExecutorResolver;
  /** Sanitizes an error to a safe, value-free string for the ledger. */
  sanitize?: (error: unknown) => string;
}

/**
 * A CleanupLedger wrapper that also holds live per-sequence destructors. It
 * implements CleanupLedger so it can be handed to world provisioners as
 * `WorldContext.ledger`; provisioners that attach a destructor call
 * `registerResource`, while the frozen `register` still works for callers that
 * do not.
 */
export class CleanupRunner implements CleanupLedger {
  private readonly executors = new Map<number, CleanupExecutor>();

  constructor(
    private readonly ledger: CleanupLedger,
    private readonly options: ReconcileOptions = {},
  ) {}

  register(
    entry: Parameters<CleanupLedger["register"]>[0],
  ): Promise<number> {
    return this.ledger.register(entry);
  }

  transition(sequence: number, state: CleanupEntry["state"], error?: string): Promise<void> {
    return this.ledger.transition(sequence, state, error);
  }

  entries(): Promise<readonly CleanupEntry[]> {
    return this.ledger.entries();
  }

  /** Register a resource AND its destructor. Persists before returning. */
  async registerResource(
    entry: Parameters<CleanupLedger["register"]>[0],
    executor: CleanupExecutor,
  ): Promise<number> {
    const sequence = await this.ledger.register(entry);
    this.executors.set(sequence, executor);
    return sequence;
  }

  async reconcile(): Promise<CleanupReconciliation> {
    return reconcileLedger(this.ledger, {
      ...this.options,
      resolver: (entry) => this.executors.get(entry.sequence) ?? this.options.resolver?.(entry) ?? null,
    });
  }
}

/**
 * Reconcile every outstanding entry in reverse registration order. Independent
 * failures do not stop siblings; the aggregate `complete` flag is false when any
 * entry could not be cleaned.
 */
export async function reconcileLedger(
  ledger: CleanupLedger,
  options: ReconcileOptions = {},
): Promise<CleanupReconciliation> {
  const sanitize = options.sanitize ?? defaultSanitize;
  const resolve = options.resolver ?? (() => null);

  const all = [...(await ledger.entries())].sort((a, b) => b.sequence - a.sequence); // reverse
  let attempted = 0;
  let cleaned = 0;
  let alreadyAbsent = 0;

  for (const entry of all) {
    if (!needsCleanup(entry.state)) continue;
    attempted += 1;
    const executor = resolve(entry);
    await ledger.transition(entry.sequence, "cleaning");
    if (!executor) {
      await ledger.transition(entry.sequence, "failed", "no destructor available for entry");
      continue;
    }
    try {
      await executor(entry);
      await ledger.transition(entry.sequence, "cleaned");
      cleaned += 1;
    } catch (error) {
      if (error instanceof ResourceAlreadyAbsentError) {
        await ledger.transition(entry.sequence, "absent");
        alreadyAbsent += 1;
        continue;
      }
      await ledger.transition(entry.sequence, "failed", sanitize(error));
    }
  }

  const finalEntries = await ledger.entries();
  const failed = finalEntries.filter((entry) => needsCleanup(entry.state));
  return {
    attempted,
    cleaned,
    alreadyAbsent,
    failed,
    complete: failed.length === 0,
  };
}

/**
 * Replay entrypoint: load an interrupted or abandoned run's ledger from disk and
 * re-reconcile it idempotently. Already-cleaned entries are skipped; only
 * outstanding entries are retried, using the resolver to reconstruct
 * destructors from safe identity.
 */
export async function cleanupByRun(
  ledgerFilePath: string,
  resolver: CleanupExecutorResolver,
  options: Omit<ReconcileOptions, "resolver"> = {},
): Promise<CleanupReconciliation> {
  const ledger = new FileCleanupLedger(ledgerFilePath, {});
  return reconcileLedger(ledger, { ...options, resolver });
}

function defaultSanitize(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
