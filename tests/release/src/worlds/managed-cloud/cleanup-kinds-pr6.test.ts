import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openCleanupLedger } from "../local-workspace/cleanup-ledger.js";
import { ManagedCloudCleanupStack } from "./cleanup-kinds.js";

/**
 * Append-only PR-6 coverage for the three new cleanup categories
 * (billingFixtureCleared / relayStopped / stripeFixturesDeleted). Kept separate
 * from cleanup-kinds.test.ts so the existing suite is untouched (extension
 * contract). Proves: (a) a run that registers none of the PR-6 kinds reports all
 * three vacuously clean (true) — byte-identical evidence to today for the
 * regression; (b) each new category flips true only when its kinds reconcile.
 */

async function stackInTemp(): Promise<{ stack: ManagedCloudCleanupStack; runDir: string }> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mc-cleanup-pr6-"));
  const ledger = await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
  return { stack: new ManagedCloudCleanupStack({ ledger }), runDir };
}

test("a run using no PR-6 fixture reports every new category vacuously clean (true)", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const id = await stack.register("ec2_instance", async () => undefined);
    await stack.acquired(id, "i-1");
    const evidence = await stack.runAll();
    assert.equal(evidence.billingFixtureCleared, true);
    assert.equal(evidence.relayStopped, true);
    assert.equal(evidence.stripeFixturesDeleted, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("each PR-6 category flips true only when its registered kinds reconcile", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    for (const kind of [
      "billing_fixture_adjustment",
      "callback_relay_spool",
      "callback_relay_process",
      "stripe_test_clock",
      "stripe_customer",
    ] as const) {
      const id = await stack.register(kind, async () => undefined);
      await stack.acquired(id, `${kind}-id`);
    }
    const evidence = await stack.runAll();
    assert.equal(evidence.failed, 0);
    assert.equal(evidence.billingFixtureCleared, true);
    assert.equal(evidence.relayStopped, true);
    assert.equal(evidence.stripeFixturesDeleted, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a failed relay releaser flips relayStopped false but leaves the other categories clean", async () => {
  const { stack, runDir } = await stackInTemp();
  try {
    const okId = await stack.register("stripe_test_clock", async () => undefined);
    await stack.acquired(okId, "tc-1");
    const badId = await stack.register("callback_relay_process", async () => {
      throw new Error("relay stop failed");
    });
    await stack.acquired(badId, "relay-pid");
    const evidence = await stack.runAll();
    assert.equal(evidence.failed, 1);
    assert.equal(evidence.relayStopped, false);
    assert.equal(evidence.stripeFixturesDeleted, true);
    assert.equal(evidence.billingFixtureCleared, true); // untouched category is vacuously clean
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
