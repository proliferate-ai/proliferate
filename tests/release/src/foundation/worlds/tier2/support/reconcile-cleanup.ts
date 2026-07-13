/**
 * Reverse-registration-order cleanup reconciliation
 * (release-worlds-and-fixtures.md "Cleanup ledger"): runs every registered
 * entry's destructor in reverse sequence, continues through independent
 * failures, and persists every transition atomically via the ledger. Shared
 * by the Tier2 provisioner's own teardown and the vertical-slice driver.
 */

import type { CleanupEntry, CleanupExecutor, CleanupLedger, CleanupReconciliation } from "../../../contracts/cleanup.js";

export async function reconcileCleanup(
  ledger: CleanupLedger,
  executors: ReadonlyMap<number, CleanupExecutor>,
): Promise<CleanupReconciliation> {
  const entries = [...(await ledger.entries())].sort((a, b) => b.sequence - a.sequence);
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
      // No executor registered here for this entry. Two distinct cases:
      //  - it is still "registered"/"cleaning": nothing has ever attempted
      //    cleanup, so this reconciler's own verdict is the first and only
      //    failure record for it.
      //  - it is already "failed": some OTHER owner (e.g. a self-cleaning
      //    cell that registers and cleans its own resource inline, per
      //    cells/t2-bill-1.ts) already attempted and recorded the real
      //    failure reason. Re-transitioning here would overwrite that real
      //    reason with a misleading "no executor" message and double-count
      //    the same failure — count it once, using its own recorded reason.
      if (entry.state !== "failed") {
        await ledger.transition(entry.sequence, "failed", "no cleanup executor registered for this entry");
        failed.push({ ...entry, state: "failed", lastError: "no cleanup executor registered for this entry" });
      } else {
        failed.push(entry);
      }
      continue;
    }
    await ledger.transition(entry.sequence, "cleaning");
    try {
      await executor(entry);
      await ledger.transition(entry.sequence, "cleaned");
      cleaned += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ledger.transition(entry.sequence, "failed", message);
      failed.push({ ...entry, state: "failed", lastError: message });
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
