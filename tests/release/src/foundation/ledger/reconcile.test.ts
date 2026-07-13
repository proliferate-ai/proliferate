import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FileCleanupLedger } from "./file-ledger.js";
import { CleanupRunner, reconcileLedger, cleanupByRun, ResourceAlreadyAbsentError } from "./reconcile.js";
import type { CleanupExecutor } from "../contracts/cleanup.js";

function newLedgerFile(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "reconcile-"));
  return { dir, file: path.join(dir, "cleanup.jsonl") };
}

const entry = (resourceId: string) => ({
  runId: "run-1",
  shardId: "shard-1-of-1",
  provider: "e2b",
  resourceType: "sandbox",
  resourceId,
  owningWorld: "managed-cloud",
});

test("reconcile runs destructors in reverse registration order", async () => {
  const { dir, file } = newLedgerFile();
  const runner = new CleanupRunner(new FileCleanupLedger(file));
  const order: string[] = [];
  const destructor = (id: string): CleanupExecutor => async () => {
    order.push(id);
  };
  await runner.registerResource(entry("first"), destructor("first"));
  await runner.registerResource(entry("second"), destructor("second"));
  await runner.registerResource(entry("third"), destructor("third"));
  const result = await runner.reconcile();
  assert.deepEqual(order, ["third", "second", "first"], "reverse order");
  assert.equal(result.complete, true);
  assert.equal(result.cleaned, 3);
  rmSync(dir, { recursive: true, force: true });
});

test("reconcile continues after an independent failure and reports it non-green", async () => {
  const { dir, file } = newLedgerFile();
  const runner = new CleanupRunner(new FileCleanupLedger(file));
  const cleaned: string[] = [];
  await runner.registerResource(entry("ok-1"), async () => {
    cleaned.push("ok-1");
  });
  await runner.registerResource(entry("bad"), async () => {
    throw new Error("provider 500");
  });
  await runner.registerResource(entry("ok-2"), async () => {
    cleaned.push("ok-2");
  });
  const result = await runner.reconcile();
  assert.deepEqual(cleaned.sort(), ["ok-1", "ok-2"], "siblings still cleaned");
  assert.equal(result.complete, false, "a failed cleanup keeps the aggregate non-green");
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].resourceId, "bad");
  assert.match(result.failed[0].lastError ?? "", /provider 500/);
  rmSync(dir, { recursive: true, force: true });
});

test("an already-absent resource is idempotent success (not a failure)", async () => {
  const { dir, file } = newLedgerFile();
  const runner = new CleanupRunner(new FileCleanupLedger(file));
  await runner.registerResource(entry("gone"), async () => {
    throw new ResourceAlreadyAbsentError();
  });
  const result = await runner.reconcile();
  assert.equal(result.complete, true);
  assert.equal(result.alreadyAbsent, 1);
  const [folded] = await runner.entries();
  assert.equal(folded.state, "absent");
  rmSync(dir, { recursive: true, force: true });
});

test("reconcile is idempotent: a second pass does not re-run cleaned destructors", async () => {
  const { dir, file } = newLedgerFile();
  const runner = new CleanupRunner(new FileCleanupLedger(file));
  let calls = 0;
  await runner.registerResource(entry("once"), async () => {
    calls += 1;
  });
  await runner.reconcile();
  await runner.reconcile();
  assert.equal(calls, 1, "cleaned entry is not retried");
  rmSync(dir, { recursive: true, force: true });
});

test("cleanupByRun replays a crashed run's ledger from disk using a resolver", async () => {
  const { dir, file } = newLedgerFile();
  // Simulate an interrupted run: entries registered, never cleaned. A fresh
  // process has NO in-memory executors, so replay must reconstruct them.
  const original = new FileCleanupLedger(file);
  await original.register(entry("sbx-a"));
  await original.register(entry("sbx-b"));

  const deleted: string[] = [];
  const resolver = (e: { resourceId: string; provider: string }) =>
    e.provider === "e2b" ? async () => void deleted.push(e.resourceId) : null;

  const result = await cleanupByRun(file, resolver);
  assert.equal(result.complete, true);
  assert.deepEqual(deleted.sort(), ["sbx-a", "sbx-b"]);

  // Second replay is a no-op: everything already cleaned.
  const again = await cleanupByRun(file, resolver);
  assert.equal(again.attempted, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("reconcile marks an entry failed when no destructor can be resolved", async () => {
  const { dir, file } = newLedgerFile();
  const ledger = new FileCleanupLedger(file);
  await ledger.register(entry("orphan"));
  const result = await reconcileLedger(ledger, { resolver: () => null });
  assert.equal(result.complete, false);
  assert.match(result.failed[0].lastError ?? "", /no destructor/);
  rmSync(dir, { recursive: true, force: true });
});
