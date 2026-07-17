import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openCleanupLedger } from "../local-workspace/cleanup-ledger.js";
import { MANAGED_CLOUD_CLEANUP_KINDS, ManagedCloudCleanupStack } from "./cleanup-kinds.js";

/**
 * Append-only coverage for the two MANAGED-CLOUD-FIXTURE-SMOKE-1 cleanup kinds
 * (`stripe_webhook_endpoint`, `stripe_product_price`). Kept separate from the
 * existing cleanup-kinds suites (extension contract). Proves: (a) both kinds are
 * registered kinds; (b) they fold into the `stripeFixturesDeleted` category —
 * reconciling flips it true; (c) a failed webhook-endpoint releaser flips
 * `stripeFixturesDeleted` false while leaving unrelated categories clean.
 */

async function stackInTemp(): Promise<{ stack: ManagedCloudCleanupStack; runDir: string }> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mc-cleanup-smoke-"));
  const ledger = await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
  return { stack: new ManagedCloudCleanupStack({ ledger }), runDir };
}

test("the two fixture-smoke Stripe kinds are registered managed-cloud cleanup kinds", () => {
  assert.ok(MANAGED_CLOUD_CLEANUP_KINDS.includes("stripe_webhook_endpoint"));
  assert.ok(MANAGED_CLOUD_CLEANUP_KINDS.includes("stripe_product_price"));
});

test("reconciling the webhook endpoint + product+price folds into stripeFixturesDeleted=true", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    for (const kind of ["stripe_webhook_endpoint", "stripe_product_price"] as const) {
      const id = await stack.register(kind, async () => undefined);
      await stack.acquired(id, `${kind}-id`);
    }
    const evidence = await stack.runAll();
    assert.equal(evidence.failed, 0);
    assert.equal(evidence.stripeFixturesDeleted, true);
    // Unrelated categories stay vacuously clean.
    assert.equal(evidence.billingFixtureCleared, true);
    assert.equal(evidence.relayStopped, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a failed webhook-endpoint releaser flips stripeFixturesDeleted false", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const okId = await stack.register("stripe_product_price", async () => undefined);
    await stack.acquired(okId, "prod_1/price_1");
    const badId = await stack.register("stripe_webhook_endpoint", async () => {
      throw new Error("webhook delete failed");
    });
    await stack.acquired(badId, "we_1");
    const evidence = await stack.runAll();
    assert.equal(evidence.failed, 1);
    assert.equal(evidence.stripeFixturesDeleted, false);
    assert.equal(evidence.billingFixtureCleared, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
