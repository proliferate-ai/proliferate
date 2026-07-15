import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTier2BillingEvidence,
  createLedgerProbe,
  createPolicyAsserter,
  createStripeIdCollector,
  type LedgerCounts,
  type LedgerRowCounter,
} from "./evidence.js";
import type { Tier2BillingEvidenceV1 } from "../../evidence/schema.js";

test("createPolicyAsserter merges successive record() calls and snapshots an independent copy", () => {
  const policy = createPolicyAsserter();
  policy.record({ free_grant_usd: 2 });
  policy.record({ llm_per_seat_usd: 5, compute_per_seat_usd: 15 });
  const snap = policy.snapshot();
  assert.deepEqual(snap, { free_grant_usd: 2, llm_per_seat_usd: 5, compute_per_seat_usd: 15 });
  // Mutating the snapshot must not bleed back into the recorder.
  snap.free_grant_usd = 999;
  assert.equal(policy.snapshot().free_grant_usd, 2);
});

test("createStripeIdCollector de-duplicates, ignores empty strings, and keeps the two id kinds separate", () => {
  const ids = createStripeIdCollector();
  ids.addObject("sub_1");
  ids.addObject("sub_1");
  ids.addObject("");
  ids.addObject("cus_1");
  ids.addTestClock("tc_1");
  ids.addTestClock("");
  assert.deepEqual([...ids.objectIds()].sort(), ["cus_1", "sub_1"]);
  assert.deepEqual(ids.testClockIds(), ["tc_1"]);
});

test("buildTier2BillingEvidence assembles a bounded, sorted, de-duplicated, secret-free object", () => {
  const policy = createPolicyAsserter();
  policy.record({ overage_cap_usd_per_org_month: 50, compute_margin_multiplier: 1.5 });
  const ids = createStripeIdCollector();
  ids.addObject("sub_9");
  ids.addObject("cus_1");
  ids.addObject("sub_9");
  ids.addTestClock("tc_2");
  ids.addTestClock("tc_1");
  const ledger: Tier2BillingEvidenceV1["ledger"] = {
    grants_delta: 1,
    seat_adjustments_delta: 0,
    usage_exports_delta: 3,
    llm_events_delta: 0,
    webhook_receipts_delta: 2,
    holds_delta: 0,
  };
  const evidence = buildTier2BillingEvidence({
    manifestId: "T2-BILL-14",
    serverVersion: "1.2.3",
    billingMode: "enforce",
    policy,
    ids,
    ledger,
  });
  assert.equal(evidence.kind, "tier2_billing");
  assert.equal(evidence.manifest_id, "T2-BILL-14");
  assert.equal(evidence.server_version, "1.2.3");
  assert.equal(evidence.billing_mode, "enforce");
  assert.deepEqual(evidence.asserted_policy, { overage_cap_usd_per_org_month: 50, compute_margin_multiplier: 1.5 });
  assert.deepEqual(evidence.stripe.object_ids, ["cus_1", "sub_9"]);
  assert.deepEqual(evidence.stripe.test_clock_ids, ["tc_1", "tc_2"]);
  assert.deepEqual(evidence.ledger, ledger);
});

test("buildTier2BillingEvidence throws when the object-id array exceeds its bounded cap", () => {
  const ids = createStripeIdCollector();
  for (let i = 0; i < 51; i += 1) {
    ids.addObject(`sub_${String(i).padStart(3, "0")}`);
  }
  assert.throws(
    () =>
      buildTier2BillingEvidence({
        manifestId: "T2-BILL-1",
        serverVersion: "1",
        billingMode: "enforce",
        policy: createPolicyAsserter(),
        ids,
        ledger: emptyLedger(),
      }),
    /object_ids exceeds the bounded cap of 50/,
  );
});

test("buildTier2BillingEvidence throws when the test-clock-id array exceeds its bounded cap", () => {
  const ids = createStripeIdCollector();
  for (let i = 0; i < 21; i += 1) {
    ids.addTestClock(`tc_${String(i).padStart(3, "0")}`);
  }
  assert.throws(
    () =>
      buildTier2BillingEvidence({
        manifestId: "T2-BILL-1",
        serverVersion: "1",
        billingMode: "enforce",
        policy: createPolicyAsserter(),
        ids,
        ledger: emptyLedger(),
      }),
    /test_clock_ids exceeds the bounded cap of 20/,
  );
});

test("createLedgerProbe computes per-field deltas against the baseline and clamps negatives to zero", async () => {
  let seenDbUrl = "";
  let call = 0;
  const baseline: LedgerCounts = {
    grants_delta: 5,
    seat_adjustments_delta: 0,
    usage_exports_delta: 0,
    llm_events_delta: 0,
    webhook_receipts_delta: 0,
    holds_delta: 2,
  };
  const now: LedgerCounts = {
    grants_delta: 7,
    seat_adjustments_delta: 0,
    usage_exports_delta: 3,
    llm_events_delta: 0,
    webhook_receipts_delta: 0,
    holds_delta: 0,
  };
  const counter: LedgerRowCounter = async (databaseUrl) => {
    seenDbUrl = databaseUrl;
    call += 1;
    return call === 1 ? baseline : now;
  };
  const probe = createLedgerProbe("postgresql://localhost/t2billing", counter);
  await probe.begin();
  const delta = await probe.delta();
  assert.equal(seenDbUrl, "postgresql://localhost/t2billing");
  assert.deepEqual(delta, {
    grants_delta: 2,
    seat_adjustments_delta: 0,
    usage_exports_delta: 3,
    llm_events_delta: 0,
    webhook_receipts_delta: 0,
    holds_delta: 0, // clamped from -2
  });
});

test("createLedgerProbe.delta() before begin() fails closed", async () => {
  const probe = createLedgerProbe("postgresql://localhost/t2billing", async () => emptyLedger());
  await assert.rejects(() => probe.delta(), /delta\(\) called before begin\(\)/);
});

function emptyLedger(): LedgerCounts {
  return {
    grants_delta: 0,
    seat_adjustments_delta: 0,
    usage_exports_delta: 0,
    llm_events_delta: 0,
    webhook_receipts_delta: 0,
    holds_delta: 0,
  };
}
