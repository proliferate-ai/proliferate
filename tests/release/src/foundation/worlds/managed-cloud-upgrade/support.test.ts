import assert from "node:assert/strict";
import { test } from "node:test";

import { InMemoryCleanupLedger, InMemoryEvidenceSink } from "./support.js";

function baseEntry(resourceId: string) {
  return {
    runId: "run-abc",
    shardId: "shard-1-of-1",
    provider: "e2b",
    resourceType: "sandbox",
    resourceId,
    owningWorld: "managed-cloud-upgrade",
  };
}

test("ledger reconciles in reverse order, aggregating independent failures", async () => {
  const ledger = new InMemoryCleanupLedger();
  const order: string[] = [];
  await ledger.register(baseEntry("first"), async (e) => {
    order.push(e.resourceId);
  });
  await ledger.register(baseEntry("boom"), async () => {
    throw new Error("provider 500");
  });
  await ledger.register(baseEntry("last"), async (e) => {
    order.push(e.resourceId);
  });

  const result = await ledger.reconcile();
  // Reverse order: last, boom (fails), first. A failure does not stop siblings.
  assert.deepEqual(order, ["last", "first"]);
  assert.equal(result.cleaned, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].resourceId, "boom");
  assert.equal(result.complete, false);
});

test("ledger reports complete only when nothing is left failed/registered", async () => {
  const ledger = new InMemoryCleanupLedger();
  await ledger.register(baseEntry("ok"), async () => {});
  const result = await ledger.reconcile();
  assert.equal(result.complete, true);
  assert.equal(result.cleaned, 1);
});

test("ledger refuses a secret-shaped key in an entry", async () => {
  const ledger = new InMemoryCleanupLedger();
  await assert.rejects(
    () => ledger.register({ ...baseEntry("x"), enrollmentToken: "leaked" } as never),
    /secret-shaped/,
  );
});

test("evidence sink rejects secret-shaped payload keys and finalizes exactly once", async () => {
  const sink = new InMemoryEvidenceSink();
  await sink.append({ kind: "world-ready", apiUrl: "https://api.test" });
  await assert.rejects(() => sink.append({ bearerToken: "leaked" }), /secret-shaped/);
  assert.equal(sink.events.length, 1);
});
