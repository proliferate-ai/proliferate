import assert from "node:assert/strict";
import { test } from "node:test";

import type { CleanupEntry, CleanupExecutor, CleanupLedger, CleanupState } from "../../contracts/cleanup.js";
import {
  assertExactlyOne,
  DuplicateResourceError,
  pollUntil,
  reconcileCleanup,
} from "./guards.js";

test("assertExactlyOne throws DuplicateResourceError for 0 or >1", () => {
  assert.doesNotThrow(() => assertExactlyOne("sandbox", 1));
  assert.throws(() => assertExactlyOne("sandbox", 0), DuplicateResourceError);
  assert.throws(() => assertExactlyOne("sandbox", 2), DuplicateResourceError);
});

test("pollUntil stops at the deadline and returns the last observation", async () => {
  let t = 0;
  const now = () => t;
  const sleep = async (ms: number) => {
    t += ms;
  };
  let probes = 0;
  const result = await pollUntil(
    async () => {
      probes += 1;
      return "pending";
    },
    (v) => v === "ready",
    { budgetMs: 100, intervalMs: 40, now, sleep },
  );
  assert.equal(result.satisfied, false);
  assert.equal(result.value, "pending");
  // No unbounded retry: bounded by the deadline.
  assert.ok(probes <= 4);
});

test("pollUntil returns as soon as done is satisfied", async () => {
  let t = 0;
  let n = 0;
  const result = await pollUntil(
    async () => (n += 1),
    (v) => v >= 2,
    { budgetMs: 1000, intervalMs: 10, now: () => t, sleep: async (ms) => { t += ms; } },
  );
  assert.equal(result.satisfied, true);
  assert.equal(result.value, 2);
});

/** Minimal in-memory ledger for testing the reconciler. */
function memLedger(): { ledger: CleanupLedger; rows: CleanupEntry[] } {
  const rows: CleanupEntry[] = [];
  let seq = 0;
  const ledger: CleanupLedger = {
    register: async (entry) => {
      seq += 1;
      const now = new Date().toISOString();
      rows.push({ ...entry, sequence: seq, state: "registered", attempts: 0, registeredAt: now, updatedAt: now, lastError: null });
      return seq;
    },
    transition: async (sequence: number, state: CleanupState, error?: string) => {
      const row = rows.find((r) => r.sequence === sequence);
      if (row) {
        const idx = rows.indexOf(row);
        rows[idx] = { ...row, state, attempts: row.attempts + (state === "cleaning" ? 1 : 0), updatedAt: new Date().toISOString(), lastError: error ?? row.lastError };
      }
    },
    entries: async () => rows,
  };
  return { ledger, rows };
}

test("reconcileCleanup runs in reverse order and aggregates independent failures", async () => {
  const { ledger, rows } = memLedger();
  const s1 = await ledger.register({ runId: "r", shardId: "s", provider: "e2b", resourceType: "sandbox", resourceId: "sb-1", owningWorld: "managed-cloud" });
  const s2 = await ledger.register({ runId: "r", shardId: "s", provider: "github", resourceType: "membership", resourceId: "m-1", owningWorld: "managed-cloud" });

  const order: number[] = [];
  const executors = new Map<number, CleanupExecutor>([
    [s1, async () => { order.push(s1); }],
    [s2, async () => { order.push(s2); throw new Error("boom"); }],
  ]);

  const result = await reconcileCleanup(ledger, executors);
  // Reverse registration order: s2 before s1.
  assert.deepEqual(order, [s2, s1]);
  assert.equal(result.complete, false);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].resourceId, "m-1");
  // The independent sibling still cleaned despite the failure.
  assert.equal(result.cleaned, 1);
  assert.equal(rows.find((r) => r.sequence === s1)?.state, "cleaned");
  assert.equal(rows.find((r) => r.sequence === s2)?.state, "failed");
});

test("reconcileCleanup records already-gone resources as absent (idempotent replay)", async () => {
  const { ledger } = memLedger();
  const s1 = await ledger.register({ runId: "r", shardId: "s", provider: "e2b", resourceType: "sandbox", resourceId: "sb-1", owningWorld: "managed-cloud" });
  const executors = new Map<number, CleanupExecutor>([
    [s1, async () => { throw new Error("404 not found"); }],
  ]);
  const result = await reconcileCleanup(ledger, executors, { isAbsent: (e) => String(e).includes("404") });
  assert.equal(result.complete, true);
  assert.equal(result.alreadyAbsent, 1);
});

test("reconcileCleanup fails an entry with no registered executor", async () => {
  const { ledger } = memLedger();
  await ledger.register({ runId: "r", shardId: "s", provider: "e2b", resourceType: "sandbox", resourceId: "sb-1", owningWorld: "managed-cloud" });
  const result = await reconcileCleanup(ledger, new Map());
  assert.equal(result.complete, false);
  assert.equal(result.failed.length, 1);
});
