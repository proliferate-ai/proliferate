import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { JsonlCleanupLedger } from "./jsonl-cleanup-ledger.js";
import { reconcileCleanup } from "./reconcile-cleanup.js";

function tmpLedgerPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tf-tier2-ledger-"));
  return path.join(dir, "cleanup.jsonl");
}

test("JsonlCleanupLedger: register persists an entry in 'registered' state with a monotonic sequence", async () => {
  const ledger = new JsonlCleanupLedger(tmpLedgerPath());
  const seq1 = await ledger.register({
    runId: "run-1",
    shardId: "shard-1-of-1",
    provider: "local-process",
    resourceType: "tier2-dev-stack",
    resourceId: "tf-tier2:http://127.0.0.1:1",
    owningWorld: "tier-2",
  });
  const seq2 = await ledger.register({
    runId: "run-1",
    shardId: "shard-1-of-1",
    provider: "stripe",
    resourceType: "test-clock",
    resourceId: "clock_fake",
    owningWorld: "tier-2",
  });
  assert.equal(seq1, 1);
  assert.equal(seq2, 2);
  const entries = await ledger.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].state, "registered");
  assert.equal(entries[0].attempts, 0);
});

test("JsonlCleanupLedger: transition updates state and survives a reload from disk (durability)", async () => {
  const filePath = tmpLedgerPath();
  const ledger = new JsonlCleanupLedger(filePath);
  const seq = await ledger.register({
    runId: "run-1",
    shardId: "shard-1-of-1",
    provider: "local-process",
    resourceType: "tier2-dev-stack",
    resourceId: "tf-tier2",
    owningWorld: "tier-2",
  });
  await ledger.transition(seq, "cleaning");
  await ledger.transition(seq, "cleaned");

  // A fresh instance over the same file replays the log identically —
  // simulating "cleanup-by-run command can replay after a process/runner
  // crash" (release-worlds-and-fixtures.md's cleanup ledger contract).
  const reloaded = new JsonlCleanupLedger(filePath);
  const entries = await reloaded.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, "cleaned");
  assert.equal(entries[0].lastError, null);
});

test("JsonlCleanupLedger: a failed transition records the sanitized error and keeps the entry non-cleaned", async () => {
  const ledger = new JsonlCleanupLedger(tmpLedgerPath());
  const seq = await ledger.register({
    runId: "run-1",
    shardId: "shard-1-of-1",
    provider: "local-process",
    resourceType: "tier2-dev-stack",
    resourceId: "tf-tier2",
    owningWorld: "tier-2",
  });
  await ledger.transition(seq, "cleaning");
  await ledger.transition(seq, "failed", "teardown() rejected: ECONNREFUSED");
  const [entry] = await ledger.entries();
  assert.equal(entry.state, "failed");
  assert.equal(entry.lastError, "teardown() rejected: ECONNREFUSED");
});

// ── reconcileCleanup: reverse-order, continues through independent failures ──

test("reconcileCleanup: cleans entries in reverse registration order and reports complete when all succeed", async () => {
  const ledger = new JsonlCleanupLedger(tmpLedgerPath());
  const order: number[] = [];
  const seq1 = await ledger.register({
    runId: "r",
    shardId: "s",
    provider: "local-process",
    resourceType: "a",
    resourceId: "a",
    owningWorld: "tier-2",
  });
  const seq2 = await ledger.register({
    runId: "r",
    shardId: "s",
    provider: "local-process",
    resourceType: "b",
    resourceId: "b",
    owningWorld: "tier-2",
  });
  const executors = new Map([
    [seq1, async () => { order.push(seq1); }],
    [seq2, async () => { order.push(seq2); }],
  ]);
  const result = await reconcileCleanup(ledger, executors);
  assert.deepEqual(order, [seq2, seq1]); // reverse of registration order
  assert.equal(result.complete, true);
  assert.equal(result.cleaned, 2);
  assert.equal(result.failed.length, 0);
});

test("reconcileCleanup: one independent failure does not stop cleanup of the other entry, and the aggregate is incomplete", async () => {
  const ledger = new JsonlCleanupLedger(tmpLedgerPath());
  const seq1 = await ledger.register({
    runId: "r",
    shardId: "s",
    provider: "local-process",
    resourceType: "a",
    resourceId: "a",
    owningWorld: "tier-2",
  });
  const seq2 = await ledger.register({
    runId: "r",
    shardId: "s",
    provider: "local-process",
    resourceType: "b",
    resourceId: "b",
    owningWorld: "tier-2",
  });
  let secondCleaned = false;
  const executors = new Map([
    [seq1, async () => { secondCleaned = true; }],
    [
      seq2,
      async () => {
        throw new Error("provider unreachable");
      },
    ],
  ]);
  const result = await reconcileCleanup(ledger, executors);
  assert.equal(secondCleaned, true, "the independent sibling still ran");
  assert.equal(result.complete, false);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].sequence, seq2);
});
