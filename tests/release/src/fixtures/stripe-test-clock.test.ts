import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clockNameForRun,
  createDefaultStripeTestClockTransport,
  defaultStripeHttp,
  isLiveModeSecretKey,
  resolveTestModeSecretKey,
  stripeCleanupReplayHandlers,
  stripeTestClockActor,
  StripeTestClockUnavailableError,
  type BillingSubjectBindSeam,
  type StripeHttp,
  type StripeTestClockTransport,
} from "./stripe-test-clock.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";
import {
  loadCleanupLedger,
  openCleanupLedger,
  replayLedger,
} from "../worlds/local-workspace/cleanup-ledger.js";
import { ManagedCloudCleanupStack, type ManagedCloudCleanupKind } from "../worlds/managed-cloud/cleanup-kinds.js";
import type { CleanupIntentHandle, ManagedCloudWorld } from "../worlds/managed-cloud/world.js";

const RUN = { run_id: "run-3", shard_id: "shard-1" } as ManagedCloudWorld["run"];

interface CleanupRegistration {
  kind: string;
  providerId: string;
  release: () => Promise<void>;
}

function fakeWorld(): { world: ManagedCloudWorld; cleanups: CleanupRegistration[] } {
  const cleanups: CleanupRegistration[] = [];
  const world = {
    run: RUN,
    async registerCleanup(kind: string, providerId: string, release: () => Promise<void>) {
      cleanups.push({ kind, providerId, release });
    },
  } as unknown as ManagedCloudWorld;
  return { world, cleanups };
}

function fakeActor(): AuthenticatedActor {
  return {
    role: "owner",
    userId: "u-1",
    organizationId: "org-1",
    enrollmentId: "e1",
    api: {} as never,
    session: {} as never,
    gatewayKey: {} as never,
  };
}

function fakeTransport(
  overrides: {
    /** Force createCustomerOnClock to throw (models a crash after clock create). */
    failCustomerCreate?: boolean;
    /** Recovery lookups return these (models the leaked resource still on Stripe). */
    recoverClockId?: string;
    recoverCustomerId?: string;
  } = {},
): { transport: StripeTestClockTransport; calls: string[] } {
  const calls: string[] = [];
  const transport: StripeTestClockTransport = {
    async createClock({ secretKey, name }) {
      calls.push(`createClock:${secretKey}:${name}`);
      return { testClockId: "tc_1" };
    },
    async createCustomerOnClock({ testClockId, priceId, metadata }) {
      if (overrides.failCustomerCreate) {
        throw new Error("simulated crash after clock create, before customer acquire");
      }
      calls.push(
        `createCustomer:${testClockId}:${priceId}:${metadata.proliferate_owner_scope}:${metadata.billing_subject_id}`,
      );
      return { customerId: "cus_1", subscriptionId: "sub_1" };
    },
    async advance({ testClockId, toUnix }) {
      calls.push(`advance:${testClockId}:${toUnix}`);
      return { invoiceId: `in_${toUnix}` };
    },
    async deleteClock({ testClockId }) {
      calls.push(`deleteClock:${testClockId}`);
    },
    async deleteCustomer({ customerId }) {
      calls.push(`deleteCustomer:${customerId}`);
    },
    async findTestClockByName({ name }) {
      calls.push(`findTestClockByName:${name}`);
      return overrides.recoverClockId ? { testClockId: overrides.recoverClockId } : null;
    },
    async findCustomerOnClock({ testClockId, runTag }) {
      calls.push(`findCustomerOnClock:${testClockId}:${runTag}`);
      return overrides.recoverCustomerId ? { customerId: overrides.recoverCustomerId } : null;
    },
  };
  return { transport, calls };
}

function fakeBindSeam(): { seam: BillingSubjectBindSeam; calls: string[] } {
  const calls: string[] = [];
  const seam: BillingSubjectBindSeam = {
    async resolveBillingSubjectId(_world, params) {
      calls.push(`resolve:${params.ownerScope}:${params.organizationId ?? "-"}`);
      return { billingSubjectId: "bsub_1" };
    },
    async bindStripeCustomer(_world, params) {
      calls.push(`bind:${params.billingSubjectId}:${params.customerId}`);
    },
  };
  return { seam, calls };
}

const OPTS = { secretKey: "sk_test_abc", priceId: "price_test_1" } as const;

test("sets up a test clock + subscribed customer, binds the billing subject, and registers cleanup before creation", async () => {
  const { world, cleanups } = fakeWorld();
  const { transport, calls } = fakeTransport();
  const { seam, calls: seamCalls } = fakeBindSeam();
  const handle = await stripeTestClockActor(world, fakeActor(), OPTS, transport, seam);

  assert.equal(handle.testClockId, "tc_1");
  assert.equal(handle.customerId, "cus_1");
  assert.equal(handle.subscriptionId, "sub_1");
  assert.equal(handle.billingSubjectId, "bsub_1");
  // Registered-before-create via a two-phase INTENT entry: the ledger entry
  // EXISTS before the Stripe create, carrying the run-scoped RECOVERY IDENTITY.
  assert.equal(cleanups[0].kind, "stripe_test_clock");
  assert.equal(cleanups[0].providerId, "intent:test_clock:name=proliferate-qual-renew-run-3:shard-1");
  assert.equal(cleanups[1].kind, "stripe_customer");
  assert.equal(cleanups[1].providerId, "intent:customer:runTag=run-3:shard-1");
  // The clock is created with a deterministic run-scoped NAME (so an interrupted
  // create→acquire window is recoverable by name).
  assert.equal(calls[0], "createClock:sk_test_abc:proliferate-qual-renew-run-3:shard-1");
  // The customer carries the resolved billing_subject_id in metadata so the
  // product webhook resolver attributes the renewal invoice to this actor.
  assert.equal(calls[1], "createCustomer:tc_1:price_test_1:personal:bsub_1");
  // The subject was resolved before creation and the customer bound after.
  assert.deepEqual(seamCalls, ["resolve:personal:-", "bind:bsub_1:cus_1"]);
});

test("once ACQUIRED, the intent releasers delete by the real Stripe ids", async () => {
  const { world, cleanups } = fakeWorld();
  const { transport, calls } = fakeTransport();
  const { seam } = fakeBindSeam();
  await stripeTestClockActor(world, fakeActor(), OPTS, transport, seam);
  // Both resources were created + acquired, so the intent releasers delete by
  // the real ids (tc_1 / cus_1), never a recovery lookup.
  for (const c of cleanups) await c.release();
  assert.ok(calls.includes("deleteClock:tc_1"), "acquired clock deleted by real id");
  assert.ok(calls.includes("deleteCustomer:cus_1"), "acquired customer deleted by real id");
  assert.ok(!calls.some((c) => c.startsWith("findTestClockByName")), "no recovery lookup needed when acquired");
});

test("interruption in the create→acquire window is still cleaned: the intent releaser RECOVERS the leaked resource by name/tag", async () => {
  // The clock is created (accepted by Stripe) but the customer create THROWS
  // before the customer is acquired — modelling a crash in the window. The clock
  // WAS acquired; the customer was NOT. Cleanup must delete both: the clock by
  // its acquired id, the customer by a run-tag recovery lookup.
  const { world, cleanups } = fakeWorld();
  const { transport, calls } = fakeTransport({
    failCustomerCreate: true,
    recoverCustomerId: "cus_leaked",
  });
  const { seam } = fakeBindSeam();
  await assert.rejects(
    () => stripeTestClockActor(world, fakeActor(), OPTS, transport, seam),
    /simulated crash after clock create/,
  );
  // Both intent entries were registered BEFORE any create, so they exist despite
  // the crash. Run them (reverse order like the stack would).
  for (const c of [...cleanups].reverse()) await c.release();
  // Clock was acquired → deleted by real id.
  assert.ok(calls.includes("deleteClock:tc_1"), "acquired clock still deleted");
  // Customer was NOT acquired → recovered via the clock-SCOPED customer LIST
  // (clock id from the acquired closure), then deleted.
  assert.ok(calls.includes("findCustomerOnClock:tc_1:run-3:shard-1"), "customer recovered via clock-scoped list");
  assert.ok(calls.includes("deleteCustomer:cus_leaked"), "recovered customer deleted");
});

test("an intent releaser whose resource was never created (nor recoverable) is a clean no-op", async () => {
  // Register the intents, then run cleanup with a transport whose recovery finds
  // nothing (the create truly never happened) — no delete, no throw.
  const { world, cleanups } = fakeWorld();
  const { transport, calls } = fakeTransport({ failCustomerCreate: true });
  const { seam } = fakeBindSeam();
  await assert.rejects(() => stripeTestClockActor(world, fakeActor(), OPTS, transport, seam), /simulated crash/);
  const customerCleanup = cleanups.find((c) => c.kind === "stripe_customer")!;
  await customerCleanup.release(); // recovery returns null → no-op, no throw
  assert.ok(calls.includes("findCustomerOnClock:tc_1:run-3:shard-1"));
  assert.ok(!calls.some((c) => c.startsWith("deleteCustomer:")), "nothing to delete when unrecoverable");
});

test("the stripe_customer releaser deletes the REAL customer id (not a no-op) and tolerates cascade-already-gone", async () => {
  const { world, cleanups } = fakeWorld();
  const { transport, calls } = fakeTransport();
  const { seam } = fakeBindSeam();
  await stripeTestClockActor(world, fakeActor(), OPTS, transport, seam);
  const customerCleanup = cleanups.find((c) => c.kind === "stripe_customer")!;
  await customerCleanup.release();
  assert.ok(calls.includes("deleteCustomer:cus_1"), "customer releaser must delete the real customer id");
});

test("organization scope resolves the org subject and requires an org id", async () => {
  const { world } = fakeWorld();
  const { transport } = fakeTransport();
  const { seam, calls: seamCalls } = fakeBindSeam();
  await stripeTestClockActor(world, fakeActor(), { ...OPTS, ownerScope: "organization" }, transport, seam);
  assert.equal(seamCalls[0], "resolve:organization:org-1");

  const actorNoOrg = { ...fakeActor(), organizationId: "" };
  await assert.rejects(
    () => stripeTestClockActor(world, actorNoOrg, { ...OPTS, ownerScope: "organization" }, transport, seam),
    /requires the actor to have an organization id/,
  );
});

test("advanceToNextPeriod advances by one period each call and returns the invoice id", async () => {
  const { world } = fakeWorld();
  const { transport, calls } = fakeTransport();
  const { seam } = fakeBindSeam();
  const handle = await stripeTestClockActor(world, fakeActor(), OPTS, transport, seam);
  const first = await handle.advanceToNextPeriod();
  const second = await handle.advanceToNextPeriod();
  assert.match(first.invoiceId, /^in_\d+$/);
  const firstUnix = Number(calls.find((c) => c.startsWith("advance:tc_1:"))!.split(":")[2]);
  const secondUnix = Number(calls.filter((c) => c.startsWith("advance:tc_1:"))[1].split(":")[2]);
  assert.equal(secondUnix - firstUnix, 31 * 24 * 60 * 60);
  assert.notEqual(first.invoiceId, second.invoiceId);
});

test("release deletes the test clock (cascades customers); the registered cleanup does too", async () => {
  const { world, cleanups } = fakeWorld();
  const { transport, calls } = fakeTransport();
  const { seam } = fakeBindSeam();
  const handle = await stripeTestClockActor(world, fakeActor(), OPTS, transport, seam);
  await handle.release();
  assert.ok(calls.includes("deleteClock:tc_1"));
  // The registered clock releaser also deletes the (now-known) clock id.
  await cleanups[0].release();
  assert.equal(calls.filter((c) => c === "deleteClock:tc_1").length, 2);
});

test("a live-mode secret key throws (posture guard), never creating a clock", async () => {
  const { world } = fakeWorld();
  const { transport, calls } = fakeTransport();
  await assert.rejects(
    () => stripeTestClockActor(world, fakeActor(), { secretKey: "sk_live_abc", priceId: "price_1" }, transport),
    /LIVE-mode Stripe secret key/,
  );
  assert.equal(calls.length, 0);
});

test("an unresolved key raises StripeTestClockUnavailableError (the cell reports blocked, never green)", () => {
  assert.throws(() => resolveTestModeSecretKey(undefined, {}), StripeTestClockUnavailableError);
});

test("key resolution order: explicit > STRIPE_TEST_SECRET_KEY > TIER2_BILLING_STRIPE_SECRET_KEY", () => {
  assert.equal(
    resolveTestModeSecretKey("sk_test_explicit", {
      STRIPE_TEST_SECRET_KEY: "sk_test_a",
      TIER2_BILLING_STRIPE_SECRET_KEY: "sk_test_b",
    }),
    "sk_test_explicit",
  );
  assert.equal(
    resolveTestModeSecretKey(undefined, { STRIPE_TEST_SECRET_KEY: "sk_test_a", TIER2_BILLING_STRIPE_SECRET_KEY: "sk_test_b" }),
    "sk_test_a",
  );
  assert.equal(
    resolveTestModeSecretKey(undefined, { TIER2_BILLING_STRIPE_SECRET_KEY: "sk_test_b" }),
    "sk_test_b",
  );
});

test("isLiveModeSecretKey recognizes sk_live_ and rk_live_, not test keys", () => {
  assert.equal(isLiveModeSecretKey("sk_live_x"), true);
  assert.equal(isLiveModeSecretKey("rk_live_x"), true);
  assert.equal(isLiveModeSecretKey("sk_test_x"), false);
});

test("throws when no subscription price id resolves", async () => {
  const { world } = fakeWorld();
  const { transport } = fakeTransport();
  await assert.rejects(
    () => stripeTestClockActor(world, fakeActor(), { secretKey: "sk_test_abc", env: {} }, transport),
    /no subscription price id/,
  );
});

test("resolves the price id and key from a provided env when not passed explicitly", async () => {
  const { world } = fakeWorld();
  const { transport, calls } = fakeTransport();
  const { seam } = fakeBindSeam();
  const handle = await stripeTestClockActor(
    world,
    fakeActor(),
    { env: { STRIPE_TEST_SECRET_KEY: "sk_test_env", STRIPE_TEST_CLOUD_MONTHLY_PRICE_ID: "price_env" } },
    transport,
    seam,
  );
  assert.equal(handle.testClockId, "tc_1");
  assert.match(calls[0], /^createClock:sk_test_env:/);
  assert.match(calls[1], /price_env/);
});

// --- HTTP-contract pins (PR6-CONTROL-002b r3): assert the EXACT method+path of
// each Stripe call through the default transport's injectable HTTP seam, so a
// verb/path regression (e.g. POST .../delete instead of DELETE) is caught.
function recordingHttp(): { http: StripeHttp; reqs: Array<{ method: string; path: string }> } {
  const reqs: Array<{ method: string; path: string }> = [];
  const http: StripeHttp = {
    async request(_secretKey, req) {
      reqs.push({ method: req.method, path: req.path });
      if (req.path === "/test_helpers/test_clocks") return { id: "tc_9" };
      if (req.path === "/customers") return { id: "cus_9" };
      if (req.path === "/payment_methods") return { id: "pm_9" };
      if (req.path === "/subscriptions") return { id: "sub_9" };
      return {};
    },
  };
  return { http, reqs };
}

test("HTTP contract: deleteClock is DELETE /test_helpers/test_clocks/{id} (NOT POST .../delete)", async () => {
  const { http, reqs } = recordingHttp();
  const transport = createDefaultStripeTestClockTransport(http);
  await transport.deleteClock({ secretKey: "sk_test_x", testClockId: "tc_9" });
  assert.deepEqual(reqs, [{ method: "DELETE", path: "/test_helpers/test_clocks/tc_9" }]);
});

test("HTTP contract: deleteCustomer is DELETE /customers/{id}", async () => {
  const { http, reqs } = recordingHttp();
  const transport = createDefaultStripeTestClockTransport(http);
  await transport.deleteCustomer({ secretKey: "sk_test_x", customerId: "cus_9" });
  assert.deepEqual(reqs, [{ method: "DELETE", path: "/customers/cus_9" }]);
});

test("HTTP contract: createClock/createCustomerOnClock/advance use POST on their exact paths", async () => {
  const { http, reqs } = recordingHttp();
  const transport = createDefaultStripeTestClockTransport(http);
  await transport.createClock({ secretKey: "sk_test_x", frozenTimeUnix: 100, name: "n" });
  await transport.createCustomerOnClock({ secretKey: "sk_test_x", testClockId: "tc_9", priceId: "price_1", metadata: {} });
  await transport.advance({ secretKey: "sk_test_x", testClockId: "tc_9", toUnix: 200 });
  assert.deepEqual(reqs, [
    { method: "POST", path: "/test_helpers/test_clocks" },
    { method: "POST", path: "/customers" },
    // A default payment method is attached before subscribing (Stripe rejects a
    // charge_automatically subscription on a customer with no default PM).
    { method: "POST", path: "/payment_methods" },
    { method: "POST", path: "/payment_methods/pm_9/attach" },
    { method: "POST", path: "/customers/cus_9" },
    { method: "POST", path: "/subscriptions" },
    { method: "POST", path: "/test_helpers/test_clocks/tc_9/advance" },
  ]);
});

test("HTTP contract: createCustomerOnClock attaches tok_visa as the default payment method", async () => {
  const forms: Array<{ path: string; form?: Record<string, string> }> = [];
  const http: StripeHttp = {
    async request(_k, req) {
      forms.push({ path: req.path, form: req.form });
      if (req.path === "/customers") return { id: "cus_9" };
      if (req.path === "/payment_methods") return { id: "pm_9" };
      if (req.path === "/subscriptions") return { id: "sub_9" };
      return {};
    },
  };
  const transport = createDefaultStripeTestClockTransport(http);
  await transport.createCustomerOnClock({ secretKey: "sk_test_x", testClockId: "tc_9", priceId: "price_1", metadata: {} });
  const pm = forms.find((f) => f.path === "/payment_methods");
  assert.deepEqual(pm?.form, { type: "card", "card[token]": "tok_visa" });
  const attach = forms.find((f) => f.path === "/payment_methods/pm_9/attach");
  assert.deepEqual(attach?.form, { customer: "cus_9" });
  const setDefault = forms.find((f) => f.path === "/customers/cus_9");
  assert.deepEqual(setDefault?.form, { "invoice_settings[default_payment_method]": "pm_9" });
});

test("HTTP contract: deleteClock/deleteCustomer swallow resource_missing (idempotent cleanup)", async () => {
  // The message wording for a deleted test clock is "No such billingclock"
  // (Stripe's internal object name), NOT "No such test clock" — a live run
  // threw this from the world-close releaser after the cell's own delete. The
  // tolerance must match Stripe's structured `resource_missing` code / the real
  // wording, not the assumed human string.
  const missingHttp: StripeHttp = {
    async request(_k, req) {
      if (req.method === "DELETE") throw new Error("stripeTestClockActor: No such billingclock: 'clock_x' (resource_missing)");
      return {};
    },
  };
  const transport = createDefaultStripeTestClockTransport(missingHttp);
  await transport.deleteClock({ secretKey: "sk_test_x", testClockId: "tc_gone" }); // must not throw
  const missingCustomerHttp: StripeHttp = {
    async request(_k, req) {
      if (req.method === "DELETE") throw new Error("stripeTestClockActor: No such customer: resource_missing");
      return {};
    },
  };
  await createDefaultStripeTestClockTransport(missingCustomerHttp).deleteCustomer({
    secretKey: "sk_test_x",
    customerId: "cus_gone",
  }); // must not throw
});

test("defaultStripeHttp appends Stripe's error code so idempotent-delete tolerance can key on resource_missing", async () => {
  // The real seam: a deleted test clock returns 404 with
  // { error: { message: "No such billingclock: ...", code: "resource_missing" } }.
  // Assert the thrown Error carries the code so downstream `resource_missing`
  // matching is wording-independent.
  const savedFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "No such billingclock: 'clock_x'", code: "resource_missing" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await assert.rejects(
      () => defaultStripeHttp.request("sk_test_x", { method: "DELETE", path: "/test_helpers/test_clocks/clock_x" }),
      /No such billingclock.*\(resource_missing\)/,
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// --- Durability of the intent→acquired handoff across RUNNER LOSS (PR6-CONTROL-002 r4).

/**
 * A REAL durable-ledger-backed world exposing the two-phase `registerCleanupIntent`
 * seam, so the ledger state persists to disk exactly as production does. Mirrors
 * the world.ts wiring: register (intent, providerId null) → acquired(intentRef)
 * → markAcquired(realId).
 */
async function ledgerBackedWorld(runDir: string): Promise<{
  world: ManagedCloudWorld;
  stack: ManagedCloudCleanupStack;
}> {
  const ledger = await openCleanupLedger({ runDir, runId: "run-3", shardId: "shard-1" });
  const stack = new ManagedCloudCleanupStack({ ledger });
  const world = {
    run: { run_id: "run-3", shard_id: "shard-1" },
    async registerCleanupIntent(
      kind: ManagedCloudCleanupKind,
      intentRef: string,
      release: () => Promise<void>,
    ): Promise<CleanupIntentHandle> {
      const entryId = await stack.register(kind, release);
      await stack.acquired(entryId, intentRef);
      return { entryId, markAcquired: (realId: string) => stack.acquired(entryId, realId) };
    },
  } as unknown as ManagedCloudWorld;
  return { world, stack };
}

/** A persistent Stripe fake: recovery lookups find the clock that was accepted before the crash. */
function persistentStripeFake(): { transport: StripeTestClockTransport; calls: string[] } {
  const calls: string[] = [];
  const clocks = new Map<string, string>(); // name -> id
  const transport: StripeTestClockTransport = {
    async createClock({ name }) {
      clocks.set(name, "tc_live");
      calls.push(`createClock:${name}`);
      return { testClockId: "tc_live" };
    },
    async createCustomerOnClock() {
      // The crash happens here (before markAcquired for the customer).
      throw new Error("simulated runner death after clock create, before customer acquire");
    },
    async advance() {
      return { invoiceId: "in_x" };
    },
    async deleteClock({ testClockId }) {
      calls.push(`deleteClock:${testClockId}`);
    },
    async deleteCustomer({ customerId }) {
      calls.push(`deleteCustomer:${customerId}`);
    },
    async findTestClockByName({ name }) {
      calls.push(`findTestClockByName:${name}`);
      const id = clocks.get(name);
      return id ? { testClockId: id } : null;
    },
    async findCustomerOnClock({ testClockId }) {
      calls.push(`findCustomerOnClock:${testClockId}`);
      return null; // the customer was never created (crash was in createCustomerOnClock).
    },
  };
  return { transport, calls };
}

test("RUNNER-LOSS regression: a clock created before markAcquire is recovered + deleted by replaying the RELOADED ledger alone (no closures)", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const runDir = await mkdtemp(path.join(os.tmpdir(), "stripe-ledger-"));
  try {
    const { world } = await ledgerBackedWorld(runDir);
    const { transport, calls } = persistentStripeFake();
    const { seam } = fakeBindSeam();

    // Run the fixture: the clock is created (accepted by Stripe) but the customer
    // create THROWS before the customer is acquired — modelling runner death.
    await assert.rejects(
      () => stripeTestClockActor(world, fakeActor(), OPTS, transport, seam),
      /simulated runner death/,
    );
    // The clock WAS created; but its markAcquired for the clock DID run (it is
    // acquired before the customer create). The decisive proof is recovery FROM
    // THE LEDGER ENTRY ALONE.
    calls.length = 0; // discard everything the in-process run recorded/closed over.

    // RELOAD the persisted ledger from disk — no fixture closure survives.
    const reloaded = await loadCleanupLedger(runDir);
    // A fresh replay handler set, backed by the SAME persistent Stripe fake that
    // still holds the created clock. `now` is PAST the propagation window so the
    // customer's empty lookup reconciles as truly-never-created (the customer
    // create threw); `ledgerEntries` lets the customer handler read the clock id.
    const handlers = stripeCleanupReplayHandlers({
      secretKey: "sk_test_x",
      transport,
      ledgerEntries: reloaded.entries(),
      now: () => new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    const result = await replayLedger(reloaded, handlers);

    // The clock entry reconciled: its providerId held the real tc_live id
    // (markAcquired ran for the clock), so it deleted by id. The customer entry
    // held the intent recovery id → looked up on the clock (found none) → past the
    // window → clean reconcile. Both reconcile from the ledger ALONE.
    assert.ok(calls.includes("deleteClock:tc_live"), "clock deleted from reloaded ledger entry");
    assert.equal(result.failed, 0, "every entry reconciled from the reloaded ledger");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("RUNNER-LOSS regression: a clock accepted but NEVER acquired (intent-only ledger entry) is located by name + deleted on replay", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const runDir = await mkdtemp(path.join(os.tmpdir(), "stripe-ledger-intent-"));
  try {
    // Simulate the WORST window: intent persisted, Stripe accepted the clock, but
    // the runner died BEFORE markAcquired — so the ledger entry still holds the
    // intent recovery id. Build that ledger state directly, then reload + replay.
    const ledger = await openCleanupLedger({ runDir, runId: "run-3", shardId: "shard-1" });
    const stack = new ManagedCloudCleanupStack({ ledger });
    const runTag = "run-3:shard-1";
    const clockName = clockNameForRun(runTag);
    const entryId = await stack.register("stripe_test_clock", async () => undefined);
    await stack.acquired(entryId, `intent:test_clock:name=${clockName}`); // intent-only, no markAcquired.

    // The clock exists on Stripe under that name (created just before death).
    const { transport, calls } = persistentStripeFake();
    await transport.createClock({ secretKey: "sk_test_x", frozenTimeUnix: 0, name: clockName });
    calls.length = 0;

    const reloaded = await loadCleanupLedger(runDir);
    const handlers = stripeCleanupReplayHandlers({ secretKey: "sk_test_x", transport });
    const result = await replayLedger(reloaded, handlers);

    // The intent-only entry located the clock by its run-scoped name and DELETEd it.
    assert.ok(calls.includes(`findTestClockByName:${clockName}`), "located by run-scoped name");
    assert.ok(calls.includes("deleteClock:tc_live"), "leaked clock deleted from intent entry alone");
    assert.equal(result.failed, 0);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("happy-path replay: a real Stripe clock_ id in the reloaded ledger deletes by id without any lookup", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const runDir = await mkdtemp(path.join(os.tmpdir(), "stripe-ledger-happy-"));
  try {
    const ledger = await openCleanupLedger({ runDir, runId: "run-3", shardId: "shard-1" });
    const stack = new ManagedCloudCleanupStack({ ledger });
    const clockEntry = await stack.register("stripe_test_clock", async () => undefined);
    await stack.acquired(clockEntry, "intent:test_clock:name=x");
    await stack.acquired(clockEntry, "clock_acq"); // Stripe's real prefix; markAcquired persisted it.
    const custEntry = await stack.register("stripe_customer", async () => undefined);
    await stack.acquired(custEntry, "cus_acq");

    const { transport, calls } = persistentStripeFake();
    const reloaded = await loadCleanupLedger(runDir);
    const result = await replayLedger(reloaded, stripeCleanupReplayHandlers({ secretKey: "sk_test_x", transport }));

    assert.ok(calls.includes("deleteClock:clock_acq"), "acquired clock deleted by real id");
    assert.ok(calls.includes("deleteCustomer:cus_acq"), "acquired customer deleted by real id");
    assert.ok(!calls.some((c) => c.startsWith("findTestClockByName")), "no lookup for an acquired real id");
    assert.equal(result.failed, 0);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

// --- Pagination + propagation-window regressions (PR6-CONTROL-002 r5).

/** A recording StripeHttp whose GET responses are scripted per call (for pagination). */
function pagedStripeHttp(pages: Record<string, Record<string, unknown>[]>): {
  http: StripeHttp;
  gets: string[];
} {
  const gets: string[] = [];
  // Each key is a full request path; return the queued page for it (FIFO per path).
  const queues: Record<string, Record<string, unknown>[][]> = {};
  const http: StripeHttp = {
    async request(_secretKey, req) {
      if (req.method === "GET") {
        gets.push(req.path);
        // has_more/data are computed by the caller-provided `pages` keyed by path.
        const body = pages[req.path];
        if (body) {
          const hasMore = body.length > 0 && (body[body.length - 1] as { __hasMore?: boolean }).__hasMore === true;
          const clean = body.map((o) => {
            const { __hasMore, ...rest } = o as Record<string, unknown> & { __hasMore?: boolean };
            void __hasMore;
            return rest;
          });
          return { data: clean, has_more: hasMore };
        }
        return { data: [], has_more: false };
      }
      if (req.method === "DELETE") {
        gets.push(`DELETE ${req.path}`);
        return {};
      }
      return {};
    },
  };
  // keep queues referenced (unused advanced form) to avoid lint noise
  void queues;
  return { http, gets };
}

test("clock pagination: the run-owned clock on a LATER page is found via starting_after and deleted", async () => {
  // Page 1 = 100 decoy clocks with has_more true (last one flagged __hasMore);
  // page 2 (starting_after=<last decoy id>) holds our run-owned clock.
  const decoys = Array.from({ length: 100 }, (_v, i) => ({
    id: `tc_decoy_${i}`,
    name: `other-${i}`,
    ...(i === 99 ? { __hasMore: true } : {}),
  }));
  const ownedName = clockNameForRun("run-9:shard-0");
  const pages = {
    "/test_helpers/test_clocks?limit=100": decoys,
    "/test_helpers/test_clocks?limit=100&starting_after=tc_decoy_99": [{ id: "tc_owned", name: ownedName }],
  };
  const { http, gets } = pagedStripeHttp(pages);
  const transport = createDefaultStripeTestClockTransport(http);

  const found = await transport.findTestClockByName({ secretKey: "sk_test_x", name: ownedName });
  assert.deepEqual(found, { testClockId: "tc_owned" });
  // Proves the second page was fetched via starting_after=<last id of page 1>.
  assert.ok(gets.includes("/test_helpers/test_clocks?limit=100"));
  assert.ok(gets.includes("/test_helpers/test_clocks?limit=100&starting_after=tc_decoy_99"));
});

test("customer recovery uses a clock-SCOPED paginated LIST (never Search), matched by run-tag metadata", async () => {
  const runTag = "run-9:shard-0";
  const pages = {
    "/customers?test_clock=tc_owned&limit=100": [
      { id: "cus_other", metadata: { proliferate_qualification_run: "someone-else" } },
      { id: "cus_ours", metadata: { proliferate_qualification_run: runTag } },
    ],
  };
  const { http, gets } = pagedStripeHttp(pages);
  const transport = createDefaultStripeTestClockTransport(http);
  const found = await transport.findCustomerOnClock({ secretKey: "sk_test_x", testClockId: "tc_owned", runTag });
  assert.deepEqual(found, { customerId: "cus_ours" });
  // A clock-scoped LIST, not /customers/search.
  assert.ok(gets.some((p) => p.startsWith("/customers?test_clock=tc_owned")));
  assert.ok(!gets.some((p) => p.includes("/customers/search")));
});

/** A transport whose customer lookup is empty on the first pass and finds it on the second. */
function laggedCustomerTransport(): { transport: StripeTestClockTransport; calls: string[]; reveal: () => void } {
  const calls: string[] = [];
  let visible = false;
  const transport: StripeTestClockTransport = {
    async createClock() {
      return { testClockId: "tc_live" };
    },
    async createCustomerOnClock() {
      return { customerId: "cus_live", subscriptionId: "sub_live" };
    },
    async advance() {
      return { invoiceId: "in_x" };
    },
    async deleteClock({ testClockId }) {
      calls.push(`deleteClock:${testClockId}`);
    },
    async deleteCustomer({ customerId }) {
      calls.push(`deleteCustomer:${customerId}`);
    },
    async findTestClockByName({ name }) {
      calls.push(`findTestClockByName:${name}`);
      return { testClockId: "tc_live" }; // the clock is visible.
    },
    async findCustomerOnClock({ testClockId }) {
      calls.push(`findCustomerOnClock:${testClockId}`);
      return visible ? { customerId: "cus_live" } : null; // lagged read-after-write.
    },
  };
  return { transport, calls, reveal: () => (visible = true) };
}

test("propagation window: an empty customer lookup within the window leaves the entry UNRECONCILED; a later pass finds + deletes it", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const runDir = await mkdtemp(path.join(os.tmpdir(), "stripe-window-"));
  try {
    const runTag = "run-3:shard-1";
    const ledger = await openCleanupLedger({ runDir, runId: "run-3", shardId: "shard-1" });
    const stack = new ManagedCloudCleanupStack({ ledger });
    // Intent-only customer entry (accepted before markAcquired).
    const entryId = await stack.register("stripe_customer", async () => undefined);
    await stack.acquired(entryId, `intent:customer:runTag=${runTag}`);

    const { transport, calls, reveal } = laggedCustomerTransport();
    const reloaded = await loadCleanupLedger(runDir);

    // PASS 1: within window, customer not visible yet → handler throws → entry
    // stays unreconciled (replayLedger counts it failed).
    const pass1 = await replayLedger(
      reloaded,
      stripeCleanupReplayHandlers({
        secretKey: "sk_test_x",
        transport,
        ledgerEntries: reloaded.entries(),
        now: () => new Date(), // registered just now → within the window.
      }),
    );
    assert.equal(pass1.failed, 1, "empty in-window lookup must leave the entry retryable (failed)");
    assert.equal(pass1.reconciled, 0);
    assert.ok(reloaded.unreconciled().some((e) => e.kind === "stripe_customer"), "entry still unreconciled");
    assert.ok(!calls.some((c) => c.startsWith("deleteCustomer")), "nothing deleted on the empty pass");

    // PASS 2: the customer is now visible → found + deleted + reconciled.
    reveal();
    const pass2 = await replayLedger(
      reloaded,
      stripeCleanupReplayHandlers({
        secretKey: "sk_test_x",
        transport,
        ledgerEntries: reloaded.entries(),
        now: () => new Date(),
      }),
    );
    assert.equal(pass2.failed, 0);
    assert.equal(pass2.reconciled, 1);
    assert.ok(calls.includes("deleteCustomer:cus_live"), "second pass deletes the now-visible customer");
    assert.equal(reloaded.unreconciled().length, 0, "entry reconciled after the second pass");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("propagation window: PAST the window, an exhaustive empty lookup reconciles clean (truly-never-created)", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const runDir = await mkdtemp(path.join(os.tmpdir(), "stripe-window-past-"));
  try {
    const runTag = "run-3:shard-1";
    const ledger = await openCleanupLedger({ runDir, runId: "run-3", shardId: "shard-1" });
    const stack = new ManagedCloudCleanupStack({ ledger });
    const entryId = await stack.register("stripe_test_clock", async () => undefined);
    await stack.acquired(entryId, `intent:test_clock:name=${clockNameForRun(runTag)}`);

    // A transport whose clock lookup is permanently empty (clock never created).
    const calls: string[] = [];
    const transport: StripeTestClockTransport = {
      async createClock() { return { testClockId: "tc_x" }; },
      async createCustomerOnClock() { return { customerId: "c", subscriptionId: "s" }; },
      async advance() { return { invoiceId: "i" }; },
      async deleteClock() { calls.push("deleteClock"); },
      async deleteCustomer() { calls.push("deleteCustomer"); },
      async findTestClockByName({ name }) { calls.push(`findTestClockByName:${name}`); return null; },
      async findCustomerOnClock() { return null; },
    };
    const reloaded = await loadCleanupLedger(runDir);
    const result = await replayLedger(
      reloaded,
      stripeCleanupReplayHandlers({
        secretKey: "sk_test_x",
        transport,
        ledgerEntries: reloaded.entries(),
        now: () => new Date(Date.now() + 2 * 60 * 60 * 1000), // past the 75-minute window.
      }),
    );
    assert.equal(result.failed, 0, "past the window an empty lookup reconciles clean");
    assert.equal(result.reconciled, 1);
    assert.ok(!calls.includes("deleteClock"), "nothing to delete — clock was never created");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("malformed cleanup timestamps fail closed instead of treating an invisible intent as never-created", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const runDir = await mkdtemp(path.join(os.tmpdir(), "stripe-ledger-malformed-time-"));
  try {
    const ledger = await openCleanupLedger({ runDir, runId: "run-3", shardId: "shard-1" });
    const stack = new ManagedCloudCleanupStack({ ledger });
    const entryId = await stack.register("stripe_test_clock", async () => undefined);
    await stack.acquired(entryId, `intent:test_clock:name=${clockNameForRun("run-3:shard-1")}`);

    const raw = JSON.parse(await (await import("node:fs/promises")).readFile(
      path.join(runDir, "cleanup-ledger.json"),
      "utf8",
    )) as { entries: Array<{ entryId: string; createdAt: string }> };
    raw.entries.find((entry) => entry.entryId === entryId)!.createdAt = "not-a-timestamp";
    await (await import("node:fs/promises")).writeFile(
      path.join(runDir, "cleanup-ledger.json"),
      JSON.stringify(raw),
    );

    const reloaded = await loadCleanupLedger(runDir);
    const { transport } = fakeTransport();
    const result = await replayLedger(
      reloaded,
      stripeCleanupReplayHandlers({ secretKey: "sk_test_x", transport }),
    );
    assert.equal(result.failed, 1);
    assert.equal(reloaded.unreconciled().length, 1);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
