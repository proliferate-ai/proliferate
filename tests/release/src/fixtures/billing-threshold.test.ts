import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  billingThreshold,
  hashBillingSourceRef,
  RECEIPT_MERGE_HELPER_PY,
  type BillingThresholdPositionParams,
  type BillingThresholdPositionResult,
  type BillingThresholdTransport,
} from "./billing-threshold.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";
import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";

const RUN = { run_id: "run-9", shard_id: "shard-0" } as ManagedCloudWorld["run"];

interface CleanupRegistration {
  kind: string;
  providerId: string;
  release: () => Promise<void>;
}

function fakeWorld(overrides: { hasBox?: boolean } = {}): {
  world: ManagedCloudWorld;
  cleanups: CleanupRegistration[];
} {
  const cleanups: CleanupRegistration[] = [];
  const box = {} as BoxExec;
  const world = {
    run: RUN,
    box: overrides.hasBox === false ? undefined : box,
    async registerCleanup(kind: string, providerId: string, release: () => Promise<void>) {
      cleanups.push({ kind, providerId, release });
    },
  } as unknown as ManagedCloudWorld;
  return { world, cleanups };
}

function fakeActor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    role: "owner",
    userId: "11111111-1111-4111-8111-111111111111",
    organizationId: "org-1",
    enrollmentId: "e1",
    api: {} as never,
    session: {} as never,
    gatewayKey: {} as never,
    ...overrides,
  };
}

function fakeTransport(
  result: BillingThresholdPositionResult,
): { transport: BillingThresholdTransport; calls: BillingThresholdPositionParams[] } {
  const calls: BillingThresholdPositionParams[] = [];
  const transport: BillingThresholdTransport = {
    async positionLedger(_box, params) {
      calls.push(params);
      return result;
    },
  };
  return { transport, calls };
}

test("positions the compute ledger EXACTLY, returns the observed remainder, and derives the run-tagged source_ref", async () => {
  const { world, cleanups } = fakeWorld();
  // Exact positioning: the observed remainder equals the requested balance.
  const { transport, calls } = fakeTransport({ billingSubjectId: "sub_1", effectiveRemainder: 60 });
  const result = await billingThreshold(world, fakeActor(), { ledger: "compute", balance: 60 }, transport);

  assert.equal(result.ledger, "compute");
  assert.equal(result.billingSubjectId, "sub_1");
  assert.equal(result.effectiveRemainder, 60);
  assert.equal(result.runTag, "run-9:shard-0");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sourceRef, "billing-threshold:run-9:shard-0:11111111-1111-4111-8111-111111111111:compute");
  assert.equal(calls[0].reconcile, true); // default
  assert.equal(calls[0].ownerScope, "personal"); // default
  // Registered-before-create: the cleanup was registered before positioning.
  assert.equal(cleanups.length, 1);
  assert.equal(cleanups[0].kind, "billing_fixture_adjustment");
  assert.equal(cleanups[0].providerId, calls[0].sourceRef);
});

test("FAILS loudly when the transport reports a remainder that differs from the requested balance", async () => {
  // A reduce-only compute path that could only reach 42 for a requested 60 must
  // never silently establish a different balance — exact positioning is required.
  const { world } = fakeWorld();
  const { transport } = fakeTransport({ billingSubjectId: "sub_1", effectiveRemainder: 42 });
  await assert.rejects(
    () => billingThreshold(world, fakeActor(), { ledger: "compute", balance: 60 }, transport),
    /did not establish the requested compute balance/,
  );
});

test("compute positioning tolerates sub-second float drift within epsilon", async () => {
  const { world } = fakeWorld();
  const { transport } = fakeTransport({ billingSubjectId: "s", effectiveRemainder: 60.4 });
  const result = await billingThreshold(world, fakeActor(), { ledger: "compute", balance: 60 }, transport);
  assert.equal(result.effectiveRemainder, 60.4); // within the 1s compute epsilon
});

test("llm positioning surfaces reconciled/eligible enrollment counts and requires exact remainder", async () => {
  const { world } = fakeWorld();
  const { transport } = fakeTransport({
    billingSubjectId: "sub_1",
    effectiveRemainder: 5,
    litellmBudgetReconciled: true,
    reconciledEnrollments: 2,
    eligibleEnrollments: 2,
  });
  const result = await billingThreshold(world, fakeActor(), { ledger: "llm", balance: 5 }, transport);
  assert.equal(result.reconciledEnrollments, 2);
  assert.equal(result.eligibleEnrollments, 2);
  assert.equal(result.litellmBudgetReconciled, true);
});

test("the cleanup releaser reads the DURABLE on-box receipt (not a TS closure) — restores after an interrupt-mid-position", async () => {
  // Model the candidate box's filesystem for the receipt: the position step
  // writes it (here, via the fake transport, standing in for POSITION_LEDGER_PY's
  // _write_receipt BEFORE commit), then the transport "dies" (interrupt after the
  // durable receipt + db commit but before returning). The cleanup releaser must
  // still restore purely from the on-box receipt the RELEASE script reads.
  const { world, cleanups } = fakeWorld();
  const boxFiles = new Map<string, string>();
  let releaseSawReceipt: unknown = "not-run";
  const box = {
    async serverPython(_script: string, opts?: { env?: Record<string, string>; scriptName?: string }) {
      const env = opts?.env ?? {};
      if (opts?.scriptName === "release-billing-fixture-adjustment.py") {
        // Mirror RELEASE_ADJUSTMENT_PY: read the on-box receipt, act on it, delete it.
        const receiptPath = env.SEED_RECEIPT_FILE!;
        const raw = boxFiles.get(receiptPath);
        if (raw === undefined) {
          releaseSawReceipt = null;
          return { stdout: JSON.stringify({ cleared: true, restored: 0, receipt: "absent" }), stderr: "" };
        }
        const receipt = JSON.parse(raw) as { source_ref: string; modified: unknown[] };
        releaseSawReceipt = receipt;
        boxFiles.delete(receiptPath);
        return {
          stdout: JSON.stringify({ cleared: true, restored: receipt.modified.length, receipt: "consumed" }),
          stderr: "",
        };
      }
      throw new Error(`unexpected serverPython scriptName ${opts?.scriptName}`);
    },
  } as unknown as BoxExec;
  (world as { box?: BoxExec }).box = box;

  // A transport that writes the durable receipt to the fake box THEN dies —
  // exactly the interrupt-after-commit the reviewer requires to be safe.
  const modified = [{ table: "billing_grant", id: "g1", field: "remaining_seconds", original: 3600 }];
  const dyingTransport = {
    async positionLedger(_box: BoxExec, params: { receiptFile: string; sourceRef: string }) {
      boxFiles.set(params.receiptFile, JSON.stringify({ source_ref: params.sourceRef, modified }));
      throw new Error("simulated crash after durable receipt + db commit, before return");
    },
  };

  await assert.rejects(
    () => billingThreshold(world, fakeActor(), { ledger: "compute", balance: 60 }, dyingTransport as never),
    /simulated crash/,
  );
  // The cleanup was registered BEFORE positioning, so it exists despite the crash.
  assert.equal(cleanups[0].kind, "billing_fixture_adjustment");
  await cleanups[0].release();
  // The releaser restored from the durable on-box receipt (source_ref + modified),
  // NOT from any TS closure (positionLedger never returned).
  assert.deepEqual(releaseSawReceipt, {
    source_ref: "billing-threshold:run-9:shard-0:11111111-1111-4111-8111-111111111111:compute",
    modified,
  });
  // And it consumed (deleted) the receipt last.
  assert.equal(boxFiles.size, 0);
});

test("the cleanup releaser is a clean no-op when the durable receipt is absent (nothing was committed)", async () => {
  const { world, cleanups } = fakeWorld();
  let restored: unknown = "not-run";
  const box = {
    async serverPython(_script: string, opts?: { env?: Record<string, string>; scriptName?: string }) {
      restored = null; // no receipt file present
      return { stdout: JSON.stringify({ cleared: true, restored: 0, receipt: "absent" }), stderr: "" };
    },
  } as unknown as BoxExec;
  (world as { box?: BoxExec }).box = box;
  // Positioning "never happened" (transport throws before writing anything).
  await assert.rejects(
    () =>
      billingThreshold(
        world,
        fakeActor(),
        { ledger: "compute", balance: 0 },
        { async positionLedger() { throw new Error("crash before any write"); } } as never,
      ),
    /crash before any write/,
  );
  await cleanups[0].release(); // must not throw on an absent receipt
  assert.equal(restored, null);
});

test("llm ledger surfaces litellmBudgetReconciled true and threads the org id when ownerScope is organization", async () => {
  const { world } = fakeWorld();
  const { transport, calls } = fakeTransport({
    billingSubjectId: "sub_org",
    effectiveRemainder: 5,
    litellmBudgetReconciled: true,
  });
  const result = await billingThreshold(
    world,
    fakeActor({ organizationId: "org-42" }),
    { ledger: "llm", balance: 5, ownerScope: "organization" },
    transport,
  );
  assert.equal(result.litellmBudgetReconciled, true);
  assert.equal(calls[0].ownerScope, "organization");
  assert.equal(calls[0].organizationId, "org-42");
  assert.equal(calls[0].sourceRef.endsWith(":llm"), true);
});

test("llm ledger surfaces litellmBudgetReconciled false when the transport reports a budget-sync failure", async () => {
  // The on-box gateway re-budget (reactivate_subject_if_credited) failed with a
  // LiteLLMIntegrationError, so the fixture records the OBSERVED truth (false)
  // rather than raising — the journey decides what to do with it.
  const { world } = fakeWorld();
  const { transport } = fakeTransport({
    billingSubjectId: "sub_1",
    effectiveRemainder: 2,
    litellmBudgetReconciled: false,
  });
  const result = await billingThreshold(world, fakeActor(), { ledger: "llm", balance: 2 }, transport);
  assert.equal(result.litellmBudgetReconciled, false);
});

test("the llm ledger rejects a balance <= 0 (reactivate_subject_if_credited no-ops at <= 0) before positioning", async () => {
  const { world } = fakeWorld();
  let positioned = false;
  const transport = {
    async positionLedger() {
      positioned = true;
      return { billingSubjectId: "s", effectiveRemainder: 0 };
    },
  };
  // balance 0 is non-negative (passes the shared check) but the llm path rejects
  // it specifically; a negative balance is caught earlier by the shared guard.
  await assert.rejects(
    () => billingThreshold(world, fakeActor(), { ledger: "llm", balance: 0 }, transport),
    /llm ledger requires balance > 0/,
  );
  await assert.rejects(
    () => billingThreshold(world, fakeActor(), { ledger: "llm", balance: -3 }, transport),
    /finite, non-negative number/,
  );
  assert.equal(positioned, false);
  // The compute ledger still allows a 0 target (exhaustion test).
  const { transport: computeTransport, calls } = fakeTransport({ billingSubjectId: "s", effectiveRemainder: 0 });
  await billingThreshold(world, fakeActor(), { ledger: "compute", balance: 0 }, computeTransport);
  assert.equal(calls.length, 1);
});

test("reconcile:false is threaded to the transport", async () => {
  const { world } = fakeWorld();
  const { transport, calls } = fakeTransport({ billingSubjectId: "s", effectiveRemainder: 0 });
  await billingThreshold(world, fakeActor(), { ledger: "compute", balance: 0, reconcile: false }, transport);
  assert.equal(calls[0].reconcile, false);
});

test("throws when the world exposes no box-exec seam (no public set-balance endpoint)", async () => {
  const { world } = fakeWorld({ hasBox: false });
  const { transport } = fakeTransport({ billingSubjectId: "s", effectiveRemainder: 0 });
  await assert.rejects(
    () => billingThreshold(world, fakeActor(), { ledger: "compute", balance: 0 }, transport),
    /no box-exec seam/,
  );
});

test("rejects a negative or non-finite balance", async () => {
  const { world } = fakeWorld();
  const { transport } = fakeTransport({ billingSubjectId: "s", effectiveRemainder: 0 });
  await assert.rejects(
    () => billingThreshold(world, fakeActor(), { ledger: "compute", balance: -1 }, transport),
    /non-negative/,
  );
  await assert.rejects(
    () => billingThreshold(world, fakeActor(), { ledger: "llm", balance: Number.NaN }, transport),
    /non-negative/,
  );
});

test("organization scope without an actor org id fails before any positioning", async () => {
  const { world, cleanups } = fakeWorld();
  let positioned = false;
  const transport: BillingThresholdTransport = {
    async positionLedger() {
      positioned = true;
      return { billingSubjectId: "s", effectiveRemainder: 0 };
    },
  };
  await assert.rejects(
    () =>
      billingThreshold(
        world,
        fakeActor({ organizationId: "" }),
        { ledger: "compute", balance: 0, ownerScope: "organization" },
        transport,
      ),
    /requires the actor to have an organization id/,
  );
  assert.equal(positioned, false);
  // The cleanup WAS registered before the org-id check (registered-before-create);
  // its releaser is a no-op against an unwritten source_ref.
  assert.equal(cleanups[0]?.kind, "billing_fixture_adjustment");
});

test("hashBillingSourceRef is a 64-hex digest and deterministic", () => {
  const a = hashBillingSourceRef("billing-threshold:run-9:shard-0:u:llm");
  const b = hashBillingSourceRef("billing-threshold:run-9:shard-0:u:llm");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
});

// --- Idempotent restoration receipt (PR6-CONTROL-001 r3): exercise the REAL
// on-box merge helper via a local python3, so a runner RETRY with the same
// identity (which sees already-mutated state) never clobbers the true
// pre-first-call originals.
const PYTHON3_AVAILABLE = (() => {
  try {
    return spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();
const skipNoPy = PYTHON3_AVAILABLE ? undefined : { skip: "python3 not available on this host" };

/** Runs `merge_receipt(receiptFile, sourceRef, modified)` via the real helper snippet. */
function runMergeReceipt(receiptFile: string, sourceRef: string, modified: unknown): void {
  const program =
    RECEIPT_MERGE_HELPER_PY +
    "\nimport sys, json\n" +
    "args = json.load(sys.stdin)\n" +
    "merge_receipt(args['receipt'], args['source_ref'], args['modified'])\n";
  const result = spawnSync("python3", ["-c", program], {
    input: JSON.stringify({ receipt: receiptFile, source_ref: sourceRef, modified }),
  });
  assert.equal(result.status, 0, result.stderr?.toString());
}

test("receipt merge is FIRST-WRITE-WINS: a retry that sees already-mutated state never clobbers the true originals", skipNoPy ?? {}, async () => {
  const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "receipt-merge-"));
  try {
    const receipt = path.join(dir, "receipt.json");
    const sourceRef = "billing-threshold:run-1:shard-0:u:compute";
    // FIRST call: grant g1 had 3600s originally; fixture reduced it to 60.
    runMergeReceipt(receipt, sourceRef, [
      { table: "billing_grant", id: "g1", field: "remaining_seconds", original: 3600 },
    ]);
    // RETRY (same identity): positioning re-reads the ALREADY-mutated grant, so
    // its "original" is now the post-first-call 60 — a naive overwrite would lose
    // the true 3600. It also touches a NEW grant g2 (original 1800).
    runMergeReceipt(receipt, sourceRef, [
      { table: "billing_grant", id: "g1", field: "remaining_seconds", original: 60 },
      { table: "billing_grant", id: "g2", field: "remaining_seconds", original: 1800 },
    ]);

    const merged = JSON.parse(await readFile(receipt, "utf8")) as {
      source_ref: string;
      modified: Array<{ id: string; original: number }>;
    };
    assert.equal(merged.source_ref, sourceRef);
    const g1 = merged.modified.find((m) => m.id === "g1")!;
    const g2 = merged.modified.find((m) => m.id === "g2")!;
    // g1 keeps the TRUE pre-first-call original (3600), NOT the retry's 60.
    assert.equal(g1.original, 3600);
    // g2 (genuinely new to the second call) is appended.
    assert.equal(g2.original, 1800);
    assert.equal(merged.modified.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
