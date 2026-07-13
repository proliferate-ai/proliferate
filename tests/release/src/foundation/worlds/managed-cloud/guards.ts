/**
 * Deadline, duplicate, and cleanup-aggregation guards for the managed-cloud
 * world. These are the small correctness primitives the vertical slice leans
 * on: a bounded poll deadline (no unbounded waits or blind retries), an
 * exactly-one guard (a provisioning path that produces a second sandbox is a
 * hard failure, never "close enough"), and a cleanup runner that continues
 * through independent failures and aggregates them.
 */

import type { CleanupEntry, CleanupExecutor, CleanupLedger, CleanupReconciliation } from "../../contracts/cleanup.js";

export class DeadlineExceededError extends Error {
  constructor(what: string, budgetMs: number) {
    super(`${what}: exceeded ${budgetMs}ms budget`);
    this.name = "DeadlineExceededError";
  }
}

export class DuplicateResourceError extends Error {
  readonly resourceType: string;
  readonly observed: number;
  constructor(resourceType: string, observed: number) {
    super(
      `expected exactly one ${resourceType}, observed ${observed}. A product path that creates a ` +
        `second ${resourceType} is a hard failure, not an acceptable retry outcome.`,
    );
    this.name = "DuplicateResourceError";
    this.resourceType = resourceType;
    this.observed = observed;
  }
}

/** Asserts an observed count is exactly one, else throws DuplicateResourceError. */
export function assertExactlyOne(resourceType: string, observed: number): void {
  if (observed !== 1) {
    throw new DuplicateResourceError(resourceType, observed);
  }
}

export interface PollOptions {
  readonly budgetMs: number;
  readonly intervalMs?: number;
  /** Injectable clock/sleep for deterministic tests. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Polls `probe` until `done` is satisfied or the deadline passes. The deadline
 * is a hard bound: it never issues a blind retry past the budget, and it
 * returns the last observation so the caller can assert on it (rather than
 * throwing an opaque timeout). Throws only if `probe` itself throws.
 */
export async function pollUntil<T>(
  probe: () => Promise<T>,
  done: (value: T) => boolean,
  options: PollOptions,
): Promise<{ value: T; satisfied: boolean; elapsedMs: number }> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = options.intervalMs ?? 2000;
  const start = now();
  const deadline = start + options.budgetMs;
  let value = await probe();
  while (!done(value) && now() < deadline) {
    await sleep(interval);
    value = await probe();
  }
  return { value, satisfied: done(value), elapsedMs: now() - start };
}

/**
 * Runs every registered cleanup executor in REVERSE registration order,
 * continuing through independent failures and transitioning each ledger entry.
 * Aggregates failures rather than throwing on the first one, so one stuck
 * resource never strands the rest. A resource whose executor reports it already
 * gone is recorded `absent` (idempotent replay success).
 */
export async function reconcileCleanup(
  ledger: CleanupLedger,
  executors: ReadonlyMap<number, CleanupExecutor>,
  options: { isAbsent?: (error: unknown) => boolean } = {},
): Promise<CleanupReconciliation> {
  const entries = [...(await ledger.entries())].sort((a, b) => b.sequence - a.sequence);
  const isAbsent = options.isAbsent ?? (() => false);
  let cleaned = 0;
  let alreadyAbsent = 0;
  const failed: CleanupEntry[] = [];

  for (const entry of entries) {
    if (entry.state === "cleaned" || entry.state === "absent") {
      if (entry.state === "absent") alreadyAbsent += 1;
      else cleaned += 1;
      continue;
    }
    const executor = executors.get(entry.sequence);
    if (!executor) {
      failed.push({ ...entry, state: "failed", lastError: "no cleanup executor registered for this resource" });
      await ledger.transition(entry.sequence, "failed", "no cleanup executor registered for this resource");
      continue;
    }
    await ledger.transition(entry.sequence, "cleaning");
    try {
      await executor(entry);
      await ledger.transition(entry.sequence, "cleaned");
      cleaned += 1;
    } catch (error) {
      if (isAbsent(error)) {
        await ledger.transition(entry.sequence, "absent");
        alreadyAbsent += 1;
        continue;
      }
      const detail = error instanceof Error ? error.message : String(error);
      await ledger.transition(entry.sequence, "failed", detail);
      failed.push({ ...entry, state: "failed", lastError: detail });
    }
  }

  return {
    attempted: entries.length,
    cleaned,
    alreadyAbsent,
    failed,
    complete: failed.length === 0,
  };
}
