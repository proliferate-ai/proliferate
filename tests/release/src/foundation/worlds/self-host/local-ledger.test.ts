import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalFileLedger, ResourceAlreadyAbsentError } from "./local-ledger.js";
import type { CleanupEntry } from "../../contracts/cleanup.js";

async function tmpLedgerPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ledger-test-"));
  return join(dir, "ledger.json");
}

function baseEntry(resourceId: string): Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError"> {
  return { runId: "run-1", shardId: "shard-1", provider: "aws-ec2", resourceType: "instance", resourceId, owningWorld: "self-host" };
}

test("register persists immediately and assigns increasing sequence numbers", async () => {
  const ledger = new LocalFileLedger(await tmpLedgerPath());
  const seq1 = await ledger.register(baseEntry("i-1"));
  const seq2 = await ledger.register(baseEntry("i-2"));
  assert.equal(seq1, 1);
  assert.equal(seq2, 2);
  const entries = await ledger.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].state, "registered");
});

test("reconcile runs destructors in reverse registration order", async () => {
  const ledger = new LocalFileLedger(await tmpLedgerPath());
  const order: string[] = [];
  await ledger.registerResource(baseEntry("first"), async () => {
    order.push("first");
  });
  await ledger.registerResource(baseEntry("second"), async () => {
    order.push("second");
  });
  await ledger.registerResource(baseEntry("third"), async () => {
    order.push("third");
  });
  const result = await ledger.reconcile();
  assert.deepEqual(order, ["third", "second", "first"]);
  assert.equal(result.cleaned, 3);
  assert.equal(result.complete, true);
  assert.equal(result.failed.length, 0);
});

test("reconcile continues through an independent destructor failure and reports it non-complete", async () => {
  const ledger = new LocalFileLedger(await tmpLedgerPath());
  const order: string[] = [];
  await ledger.registerResource(baseEntry("ok-1"), async () => {
    order.push("ok-1");
  });
  await ledger.registerResource(baseEntry("boom"), async () => {
    throw new Error("provider is down");
  });
  await ledger.registerResource(baseEntry("ok-2"), async () => {
    order.push("ok-2");
  });
  const result = await ledger.reconcile();
  // Both independent siblings still ran despite the middle one failing.
  assert.deepEqual(order, ["ok-2", "ok-1"]);
  assert.equal(result.cleaned, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].resourceId, "boom");
  assert.equal(result.complete, false);
});

test("a destructor throwing ResourceAlreadyAbsentError reconciles as absent, not failed", async () => {
  const ledger = new LocalFileLedger(await tmpLedgerPath());
  await ledger.registerResource(baseEntry("already-gone"), async () => {
    throw new ResourceAlreadyAbsentError();
  });
  const result = await ledger.reconcile();
  assert.equal(result.alreadyAbsent, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.complete, true);
});

test("reconcile is idempotent: a second call does not re-invoke a cleaned destructor", async () => {
  const ledger = new LocalFileLedger(await tmpLedgerPath());
  let calls = 0;
  await ledger.registerResource(baseEntry("once"), async () => {
    calls += 1;
  });
  await ledger.reconcile();
  await ledger.reconcile();
  assert.equal(calls, 1);
});

test("replay after a crash: a fresh ledger instance reading the same file reports the pending entry, with no destructor, as failed (never silently dropped)", async () => {
  const path = await tmpLedgerPath();
  const first = new LocalFileLedger(path);
  await first.register(baseEntry("orphan")); // registered but never given a destructor in this process — simulates a crash before registerResource's in-memory destructor map exists in a fresh process.

  const replay = new LocalFileLedger(path);
  const result = await replay.reconcile();
  assert.equal(result.attempted, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].lastError ?? "", /no destructor/);
  assert.equal(result.complete, false);

  const entries = await replay.entries();
  assert.equal(entries[0].state, "failed");

  // Cleanup the temp ledger dir.
  await rm(join(path, ".."), { recursive: true, force: true }).catch(() => {});
});

test("the ledger file on disk never contains a resourceId-shaped value under a credential-looking key", async () => {
  const path = await tmpLedgerPath();
  const ledger = new LocalFileLedger(path);
  await ledger.registerResource(baseEntry("key-pair-abc"), async () => {});
  const raw = await readFile(path, "utf8");
  assert.doesNotMatch(raw, /"lastError":"sk-|"password"|"secret"/i);
});
