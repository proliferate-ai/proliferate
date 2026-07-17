import { isStripeLiveModeUrl } from "./billing-http.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";
import { parseLastJsonLine } from "../worlds/managed-cloud/box-seeds.js";
import type { CleanupHandler, CleanupResourceKind } from "../worlds/local-workspace/cleanup-ledger.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";

/**
 * `stripeTestClockActor` — the Stripe TEST-clock actor setup for
 * CLOUD-COMPUTE-RENEW-1 (spec "New fixture obligations"; PR 6 fixture 4).
 *
 * RENEW-1 must observe a subscription cross a period boundary WITHOUT waiting a
 * real month and WITHOUT touching live money. Stripe test clocks are the
 * sanctioned mechanism: create a test clock, create a customer ON the clock,
 * subscribe them, then ADVANCE the clock to the next period — Stripe emits the
 * real renewal invoice + `invoice.*` webhooks the candidate Server processes.
 *
 * The renewal invoice must resolve to the ACTOR: the product's webhook handler
 * (`stripe_webhooks._subject_from_object`) resolves a Stripe object to a billing
 * subject via the `billing_subject_id` metadata OR the DB's Stripe-customer
 * binding (`billing_subject.stripe_customer_id`). So the fixture (1) resolves the
 * actor's product billing subject id and stamps it into the customer metadata,
 * AND (2) binds the created customer id onto that billing subject row on the
 * candidate box (`set_billing_subject_stripe_customer`) — otherwise a renewal
 * invoice from this clock resolves to no actor and creates no renewal grant.
 *
 * The fixture is TEST-MODE-ONLY by discipline: the key is resolved from
 * `STRIPE_TEST_SECRET_KEY` (falling back to `TIER2_BILLING_STRIPE_SECRET_KEY`),
 * a `sk_live_…` key THROWS, and an unresolved key raises
 * `StripeTestClockUnavailableError` so the dependent cell reports honest
 * `blocked` rather than fabricating a renewal.
 *
 * Every Stripe call is behind the injected `StripeTestClockTransport`, and the
 * on-box billing-subject resolve/bind is behind the injected
 * `BillingSubjectBindSeam`, so unit tests exercise the fixture offline with a
 * fake transport/seam and never a real Stripe account, box, or network.
 *
 * Cleanup uses a DURABLE two-phase INTENT → ACQUIRED handoff via the world's
 * `registerCleanupIntent` seam so it survives RUNNER LOSS, not just an in-process
 * throw: BEFORE each Stripe create the ledger entry is persisted with an intent
 * providerId carrying the run-scoped RECOVERY IDENTITY (clock name / customer run
 * tag); the instant Stripe returns, `markAcquired(real id)` durably replaces it.
 * A runner that dies mid-create therefore leaves the recovery identity on disk,
 * and `stripeCleanupReplayHandlers` (usable with `replayLedger` on the reloaded
 * ledger) deletes the leaked resource from the entry ALONE — real id → delete by
 * id; intent id → locate by name/tag + delete; not found → clean reconcile.
 * (When the world lacks the two-phase seam — a PR-2 world — the fixture falls
 * back to the single-shot `registerCleanup` with the same intent ref + closure
 * recovery.) `release()` deletes the clock (Stripe cascades its customers); the
 * customer releaser deletes the customer directly and tolerates a
 * cascade-already-deleted (`resource_missing`). Neither is a no-op. Deletes use
 * Stripe's real contract: `DELETE /v1/test_helpers/test_clocks/{id}` and
 * `DELETE /v1/customers/{id}`.
 */

export type OwnerScope = "personal" | "organization";

export interface StripeTestClockActorHandle {
  testClockId: string;
  customerId: string;
  subscriptionId: string;
  /** The actor's product billing subject the customer is bound to (safe id). */
  billingSubjectId: string;
  /** Advance the clock to the next billing period; returns the renewal invoice id. */
  advanceToNextPeriod(): Promise<{ invoiceId: string }>;
  /** Delete the test clock (cascades customers); idempotent. */
  release(): Promise<void>;
}

/**
 * Raised when no test-mode Stripe key resolves. The fixture returns this as a
 * blocked signal (never green) rather than throwing, so the cell records an
 * honest blocked reason.
 */
export class StripeTestClockUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeTestClockUnavailableError";
  }
}

export interface StripeTestClockOptions {
  ownerScope?: OwnerScope;
  /** Overrides the resolved env (unit tests / explicit operator lane). */
  secretKey?: string;
  /** Overrides `process.env` for key resolution. */
  env?: NodeJS.ProcessEnv;
  /** The subscription price id to put the customer on (default: the cloud monthly price env, else a required arg). */
  priceId?: string;
}

/**
 * The Stripe side-effecting seam, all injectable. The default is a real
 * Stripe-test-mode client (constructed only when a test key resolves). Unit
 * tests pass a fake so no real Stripe account is touched.
 */
export interface StripeTestClockTransport {
  createClock(params: { secretKey: string; frozenTimeUnix: number; name: string }): Promise<{ testClockId: string }>;
  createCustomerOnClock(params: {
    secretKey: string;
    testClockId: string;
    priceId: string;
    metadata: Record<string, string>;
  }): Promise<{ customerId: string; subscriptionId: string }>;
  advance(params: { secretKey: string; testClockId: string; toUnix: number }): Promise<{ invoiceId: string }>;
  deleteClock(params: { secretKey: string; testClockId: string }): Promise<void>;
  /** Delete a customer directly; tolerates cascade-already-deleted (resource_missing). */
  deleteCustomer(params: { secretKey: string; customerId: string }): Promise<void>;
  /**
   * Recover a created-but-not-yet-acquired test clock by its run-scoped `name`
   * (used by intent recovery to clean an interruption in the create→acquire
   * window). MUST paginate the cursor-paginated test-clocks list
   * (`has_more`/`starting_after`) until the clock is found or the collection is
   * truly exhausted — "not on the first page" is NOT "not found". Returns null
   * only when the run-owned clock is absent from the entire (exhausted) list.
   */
  findTestClockByName(params: { secretKey: string; name: string }): Promise<{ testClockId: string } | null>;
  /**
   * Recover a created-but-not-yet-acquired customer via a strongly-consistent,
   * clock-SCOPED paginated LIST (`GET /v1/customers?test_clock=<id>`), NOT Search
   * (Stripe Search is read-after-write-lagged up to ~1h — unsuitable for the
   * accepted-before-markAcquired window). Identifies our customer by the run-tag
   * metadata. Paginates until found or exhausted. Returns null when absent.
   */
  findCustomerOnClock(params: {
    secretKey: string;
    testClockId: string;
    runTag: string;
  }): Promise<{ customerId: string } | null>;
}

/**
 * The on-box billing-subject resolve/bind seam. `resolveAndBind` runs the
 * product's OWN store functions on the candidate box: resolve the actor's
 * (personal or org) billing subject, then bind the created Stripe customer id
 * onto it (`set_billing_subject_stripe_customer`) so the product webhook
 * resolves renewal invoices to this actor. Injectable so unit tests stay offline.
 */
export interface BillingSubjectBindSeam {
  resolveBillingSubjectId(
    world: ManagedCloudWorld,
    params: { userId: string; ownerScope: OwnerScope; organizationId?: string },
  ): Promise<{ billingSubjectId: string }>;
  bindStripeCustomer(
    world: ManagedCloudWorld,
    params: { billingSubjectId: string; customerId: string },
  ): Promise<void>;
}

/** ~31 days, the period step used to cross a monthly boundary. */
const ONE_PERIOD_SECONDS = 31 * 24 * 60 * 60;

/**
 * Id-keyed releasers: act purely on a Stripe id (== the value persisted as the
 * ledger `providerId`), so a recovered/lost runner can replay cleanup from the
 * ledger ALONE — a kind-keyed replay handler passes `entry.providerId` here.
 */
export function deleteTestClockById(
  transport: StripeTestClockTransport,
  secretKey: string,
  testClockId: string,
): Promise<void> {
  return transport.deleteClock({ secretKey, testClockId });
}

export function deleteCustomerById(
  transport: StripeTestClockTransport,
  secretKey: string,
  customerId: string,
): Promise<void> {
  return transport.deleteCustomer({ secretKey, customerId });
}

// ---------------------------------------------------------------------------
// Durable intent identity + ledger replay handlers (recovery from ledger alone)
// ---------------------------------------------------------------------------

/** Deterministic run-scoped test-clock name (the recovery identity for a leaked clock). */
export function clockNameForRun(runTag: string): string {
  return `proliferate-qual-renew-${runTag}`;
}

/**
 * The intent-phase providerId persisted in the ledger BEFORE a create. It carries
 * the run-scoped RECOVERY IDENTITY so a lost runner can locate + delete the
 * resource from the reloaded entry alone. `markAcquired(real id)` later replaces
 * it with the real `clock_…`/`cus_…` id. (`tc_…` remains accepted for
 * older fixtures.) The encodings are prefix-tagged so a replay
 * handler can tell an intent ref from a real id.
 */
export function encodeClockIntentRef(clockName: string): string {
  return `intent:test_clock:name=${clockName}`;
}
export function encodeCustomerIntentRef(runTag: string): string {
  return `intent:customer:runTag=${runTag}`;
}

/** Parses a persisted providerId into either a real Stripe id or an intent recovery identity. */
export function decodeStripeProviderId(
  providerId: string,
): { kind: "real"; id: string } | { kind: "intent_clock"; clockName: string } | { kind: "intent_customer"; runTag: string } | { kind: "unknown" } {
  if (providerId.startsWith("clock_") || providerId.startsWith("tc_") || providerId.startsWith("cus_")) {
    return { kind: "real", id: providerId };
  }
  const clockName = /^intent:test_clock:name=(.+)$/.exec(providerId);
  if (clockName) {
    return { kind: "intent_clock", clockName: clockName[1] };
  }
  const runTag = /^intent:customer:runTag=(.+)$/.exec(providerId);
  if (runTag) {
    return { kind: "intent_customer", runTag: runTag[1] };
  }
  return { kind: "unknown" };
}

/**
 * Bounded propagation window for intent recovery: an EXHAUSTIVE-but-empty lookup
 * within this window of the entry's registration is treated as "the create may
 * still be propagating / not visible" and the intent is kept RETRYABLE (the
 * handler throws, leaving the entry unreconciled). Only PAST this window may an
 * empty lookup reconcile as truly-never-created / already-deleted. Set above
 * Stripe's documented worst-case Search/read-after-write lag (~1h).
 */
export const STRIPE_INTENT_RECOVERY_WINDOW_MS = 75 * 60 * 1000;

/** Thrown by a replay handler to keep an intent entry retryable within the propagation window. */
export class StripeIntentStillPropagatingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeIntentStillPropagatingError";
  }
}

/**
 * Ledger-replay handlers for `stripe_test_clock` / `stripe_customer`, usable with
 * `replayLedger` after a runner restart. They work from the ENTRY ALONE (no
 * closures):
 *   - real `clock_`/`cus_` providerId → DELETE by id (idempotent);
 *   - intent providerId → deterministically locate the run-owned resource:
 *       * clock: paginated list by run-scoped name;
 *       * customer: recover the CLOCK first (real id from the reloaded clock
 *         entry when acquired, else paginated name lookup), then a strongly-
 *         consistent clock-SCOPED customer LIST (never Search). If no clock id is
 *         recoverable, the customer cannot exist (it is created ON the clock,
 *         AFTER it) → clean reconcile.
 *   - an EXHAUSTIVE-but-empty lookup does NOT reconcile immediately: within
 *     `STRIPE_INTENT_RECOVERY_WINDOW_MS` of the entry's `createdAt` it THROWS
 *     `StripeIntentStillPropagatingError` (leaves the entry unreconciled/
 *     retryable, so `replayLedger` counts it failed and a later pass retries);
 *     only past the window is empty treated as truly-never-created (clean).
 *
 * `deps.clockEntryProviderId` lets the customer handler read the SIBLING clock
 * entry's acquired real id from the reloaded ledger; `deps.now` is an injectable
 * clock for the window check.
 */
export function stripeCleanupReplayHandlers(params: {
  secretKey: string;
  transport?: StripeTestClockTransport;
  /** All reloaded ledger entries, so the customer handler can find its clock's real id. */
  ledgerEntries?: readonly { kind: CleanupResourceKind; providerId: string | null }[];
  now?: () => Date;
}): Partial<Record<CleanupResourceKind, CleanupHandler>> {
  const transport = params.transport ?? defaultStripeTestClockTransport;
  const { secretKey } = params;
  const now = params.now ?? (() => new Date());
  const entries = params.ledgerEntries ?? [];

  const withinWindow = (entry: { createdAt: string }): boolean => {
    const registeredAt = Date.parse(entry.createdAt);
    if (Number.isNaN(registeredAt)) {
      throw new Error("Stripe cleanup entry has a malformed createdAt timestamp; refusing to reconcile it.");
    }
    return now().getTime() - registeredAt < STRIPE_INTENT_RECOVERY_WINDOW_MS;
  };

  /** Resolve the run's clock id: the sibling clock entry's real id, else a paginated name lookup. */
  const resolveClockId = async (clockName: string): Promise<string | null> => {
    const clockEntry = entries.find(
      (e) =>
        e.kind === "stripe_test_clock" &&
        (e.providerId?.startsWith("clock_") || e.providerId?.startsWith("tc_")),
    );
    if (clockEntry?.providerId) {
      return clockEntry.providerId;
    }
    const found = await transport.findTestClockByName({ secretKey, name: clockName });
    return found?.testClockId ?? null;
  };

  return {
    stripe_test_clock: async (entry) => {
      const providerId = entry.providerId ?? "";
      const decoded = decodeStripeProviderId(providerId);
      if (decoded.kind === "real") {
        await deleteTestClockById(transport, secretKey, decoded.id);
        return;
      }
      if (decoded.kind === "intent_clock") {
        const found = await transport.findTestClockByName({ secretKey, name: decoded.clockName });
        if (found) {
          await deleteTestClockById(transport, secretKey, found.testClockId);
          return;
        }
        // Exhaustive lookup empty: keep retryable within the propagation window.
        if (withinWindow(entry)) {
          throw new StripeIntentStillPropagatingError(
            `stripe_test_clock intent "${decoded.clockName}" not found yet; still within the propagation ` +
              "window — leaving unreconciled for retry.",
          );
        }
        return; // past the window → truly-never-created / already-deleted, clean.
      }
      throw new Error(
        `stripe_test_clock cleanup entry has an unrecognized provider identity; refusing to reconcile it: ${providerId || "<empty>"}`,
      );
    },
    stripe_customer: async (entry) => {
      const providerId = entry.providerId ?? "";
      const decoded = decodeStripeProviderId(providerId);
      if (decoded.kind === "real") {
        await deleteCustomerById(transport, secretKey, decoded.id);
        return;
      }
      if (decoded.kind === "intent_customer") {
        // The customer is created ON the clock, AFTER it — so recover the clock
        // id first, then LIST that clock's customers (strongly consistent). If no
        // clock id is recoverable, the customer cannot exist → clean reconcile.
        const clockName = clockNameForRun(decoded.runTag);
        const clockId = await resolveClockId(clockName);
        if (clockId) {
          const found = await transport.findCustomerOnClock({ secretKey, testClockId: clockId, runTag: decoded.runTag });
          if (found) {
            await deleteCustomerById(transport, secretKey, found.customerId);
            return;
          }
          // Clock exists but its customer is not visible yet: retryable in-window.
          if (withinWindow(entry)) {
            throw new StripeIntentStillPropagatingError(
              `stripe_customer intent for run "${decoded.runTag}" not found on clock ${clockId} yet; still ` +
                "within the propagation window — leaving unreconciled for retry.",
            );
          }
          return;
        }
        // No clock recoverable. Within the window this may just mean the clock
        // create is still propagating (and the customer, created after it, can't
        // exist yet) → retryable; past the window → the clock was never created,
        // so the customer never was either → clean reconcile.
        if (withinWindow(entry)) {
          throw new StripeIntentStillPropagatingError(
            `stripe_customer intent for run "${decoded.runTag}": owning clock not recoverable yet; still within ` +
              "the propagation window — leaving unreconciled for retry.",
          );
        }
        return;
      }
      throw new Error(
        `stripe_customer cleanup entry has an unrecognized provider identity; refusing to reconcile it: ${providerId || "<empty>"}`,
      );
    },
  };
}

/**
 * Resolves the test-mode key, refuses a live key, and sets up a test clock +
 * subscribed customer. Registers the clock + customer for cleanup BEFORE
 * creating them. Returns a blocked-signalling handle path via
 * `StripeTestClockUnavailableError` when no key resolves.
 */
export async function stripeTestClockActor(
  world: ManagedCloudWorld,
  actor: AuthenticatedActor,
  options: StripeTestClockOptions = {},
  transport: StripeTestClockTransport = defaultStripeTestClockTransport,
  bindSeam: BillingSubjectBindSeam = defaultBillingSubjectBindSeam,
): Promise<StripeTestClockActorHandle> {
  const env = options.env ?? process.env;
  const secretKey = resolveTestModeSecretKey(options.secretKey, env);
  const priceId = options.priceId ?? env.STRIPE_TEST_CLOUD_MONTHLY_PRICE_ID?.trim();
  if (!priceId) {
    throw new Error(
      "stripeTestClockActor: no subscription price id (pass options.priceId or set " +
        "STRIPE_TEST_CLOUD_MONTHLY_PRICE_ID) — the test-clock actor must subscribe to a real test-mode price.",
    );
  }
  const ownerScope = options.ownerScope ?? "personal";
  if (ownerScope === "organization" && !actor.organizationId) {
    throw new Error("stripeTestClockActor: ownerScope 'organization' requires the actor to have an organization id.");
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const runTag = `${world.run.run_id}:${world.run.shard_id}`;
  // Run-scoped, deterministic clock name so the intent record can RECOVER a
  // clock that Stripe accepted before we acquired its id (create→acquire window).
  const clockName = clockNameForRun(runTag);

  // Resolve the actor's product billing subject FIRST so we can both stamp it
  // into the customer metadata and bind the customer onto it.
  const { billingSubjectId } = await bindSeam.resolveBillingSubjectId(world, {
    userId: actor.userId,
    ownerScope,
    organizationId: ownerScope === "organization" ? actor.organizationId : undefined,
  });

  // Two-phase INTENT → ACQUIRED cleanup handoff, made DURABLE via the world's
  // `registerCleanupIntent` seam: the ledger entry is persisted BEFORE the Stripe
  // create with a structured intent ref (carrying the run-scoped recovery
  // identity), and `markAcquired(real id)` durably replaces it the instant Stripe
  // returns. So a runner that dies in the create→acquire window leaves the
  // recovery identity on disk, and `stripeCleanupReplayHandlers` deletes the
  // leaked resource from the reloaded ledger entry ALONE. The closure releasers
  // handle the in-process happy path; when the world is a PR-2 world without the
  // two-phase seam, we fall back to the single-shot `registerCleanup`.
  const acquired: { testClockId?: string; customerId?: string } = {};

  const clockIntentRef = encodeClockIntentRef(clockName);
  const customerIntentRef = encodeCustomerIntentRef(runTag);

  const clockReleaser = async (): Promise<void> => {
    let id = acquired.testClockId;
    if (!id) {
      const found = await transport.findTestClockByName({ secretKey, name: clockName });
      id = found?.testClockId;
    }
    if (id) {
      await deleteTestClockById(transport, secretKey, id);
    }
  };
  const customerReleaser = async (): Promise<void> => {
    let id = acquired.customerId;
    if (!id) {
      // Recover the clock id first (the customer is created ON it), then LIST that
      // clock's customers (strongly consistent — never Search).
      const clockId =
        acquired.testClockId ?? (await transport.findTestClockByName({ secretKey, name: clockName }))?.testClockId;
      if (clockId) {
        const found = await transport.findCustomerOnClock({ secretKey, testClockId: clockId, runTag });
        id = found?.customerId;
      }
    }
    if (id) {
      await deleteCustomerById(transport, secretKey, id);
    }
  };

  let clockAcquire: ((realId: string) => Promise<void>) | undefined;
  let customerAcquire: ((realId: string) => Promise<void>) | undefined;
  if (world.registerCleanupIntent) {
    const clockHandle = await world.registerCleanupIntent("stripe_test_clock", clockIntentRef, clockReleaser);
    clockAcquire = clockHandle.markAcquired;
    const customerHandle = await world.registerCleanupIntent(
      "stripe_customer",
      customerIntentRef,
      customerReleaser,
    );
    customerAcquire = customerHandle.markAcquired;
  } else {
    // PR-2 world fallback: single-shot registration with the intent ref as the
    // persisted id (the closure releaser still recovers by name/tag).
    await world.registerCleanup?.("stripe_test_clock", clockIntentRef, clockReleaser);
    await world.registerCleanup?.("stripe_customer", customerIntentRef, customerReleaser);
  }

  const clock = await transport.createClock({ secretKey, frozenTimeUnix: nowUnix, name: clockName });
  const testClockId = clock.testClockId;
  acquired.testClockId = testClockId; // ACQUIRE (in-process closure).
  await clockAcquire?.(testClockId); // ACQUIRE (durable ledger: real id replaces intent ref).

  const created = await transport.createCustomerOnClock({
    secretKey,
    testClockId,
    priceId,
    metadata: {
      proliferate_qualification_run: runTag,
      proliferate_owner_scope: ownerScope,
      proliferate_user_id: actor.userId,
      // The product webhook resolver reads THIS to attribute the renewal invoice.
      billing_subject_id: billingSubjectId,
    },
  });
  const customerId = created.customerId;
  acquired.customerId = customerId; // ACQUIRE (in-process closure).
  await customerAcquire?.(customerId); // ACQUIRE (durable ledger).

  // Bind the customer id onto the actor's billing subject row on the candidate
  // box, so webhook resolution by DB customer binding also finds this actor
  // (belt-and-suspenders with the metadata above).
  await bindSeam.bindStripeCustomer(world, { billingSubjectId, customerId });

  let advancedTo = nowUnix;
  return {
    testClockId,
    customerId,
    subscriptionId: created.subscriptionId,
    billingSubjectId,
    async advanceToNextPeriod() {
      advancedTo += ONE_PERIOD_SECONDS;
      return transport.advance({ secretKey, testClockId, toUnix: advancedTo });
    },
    async release() {
      if (testClockId) {
        await transport.deleteClock({ secretKey, testClockId });
      }
    },
  };
}

/**
 * Resolves the TEST-mode Stripe secret key: explicit override, then
 * STRIPE_TEST_SECRET_KEY, then the Tier-2 fallback. Throws on a live-mode key
 * (posture guard); raises `StripeTestClockUnavailableError` when none resolves.
 */
export function resolveTestModeSecretKey(explicit: string | undefined, env: NodeJS.ProcessEnv): string {
  const key = (explicit ?? env.STRIPE_TEST_SECRET_KEY ?? env.TIER2_BILLING_STRIPE_SECRET_KEY ?? "").trim();
  if (!key) {
    throw new StripeTestClockUnavailableError(
      "stripeTestClockActor: no test-mode Stripe secret key resolved (STRIPE_TEST_SECRET_KEY, then " +
        "TIER2_BILLING_STRIPE_SECRET_KEY). The RENEW-1 cell must report blocked, never a fabricated renewal.",
    );
  }
  if (isLiveModeSecretKey(key)) {
    throw new Error(
      "stripeTestClockActor: a LIVE-mode Stripe secret key was supplied (sk_live_…). The qualification world must " +
        "run Stripe in test mode only — refusing to create a test clock against a live account.",
    );
  }
  return key;
}

/** A live-mode secret key (`sk_live_…` / `rk_live_…`). Test keys are `sk_test_…`/`rk_test_…`. */
export function isLiveModeSecretKey(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}

/**
 * Redacts a Stripe URL discipline check onto secret keys: reuse the URL-level
 * live-mode detector for any URL the transport surfaces, so a leaked live URL is
 * caught by the same guard as the key. Exposed for the fixture's tests.
 */
export function assertUrlNotLiveMode(url: string): void {
  if (isStripeLiveModeUrl(url)) {
    throw new Error(`stripeTestClockActor: a LIVE-mode Stripe URL surfaced (${url}); refusing to proceed.`);
  }
}

// ---------------------------------------------------------------------------
// Default transport — the real Stripe TEST-mode API
// ---------------------------------------------------------------------------

/** Stripe API base; test-vs-live is determined solely by the secret key. */
const STRIPE_API_BASE = "https://api.stripe.com/v1";

/**
 * The low-level Stripe HTTP seam — exposes the EXACT method + path so tests can
 * PIN the HTTP contract (a fake requester asserts `DELETE /test_helpers/
 * test_clocks/{id}` and `DELETE /customers/{id}`, catching a verb/path
 * regression). The default hits the real Stripe test-mode API via `fetch`.
 */
export interface StripeHttpRequest {
  method: "POST" | "DELETE" | "GET";
  /** Path under `/v1`, e.g. `/test_helpers/test_clocks/tc_1`. */
  path: string;
  /** Form body for POST (x-www-form-urlencoded); omitted for DELETE/GET. */
  form?: Record<string, string>;
}

export interface StripeHttp {
  request(secretKey: string, req: StripeHttpRequest): Promise<Record<string, unknown>>;
}

export const defaultStripeHttp: StripeHttp = {
  async request(secretKey, { method, path, form }) {
    const init: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(30_000),
    };
    if (form && method === "POST") {
      (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams(form);
    }
    const response = await fetch(`${STRIPE_API_BASE}${path}`, init);
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = payload.error as { message?: unknown; code?: unknown } | undefined;
      const message = typeof error?.message === "string" ? error.message : `Stripe ${method} ${path} -> ${response.status}`;
      // Append Stripe's structured error CODE when present so idempotent-delete
      // tolerance can match on `resource_missing` regardless of the human
      // message wording (a deleted test clock reports "No such billingclock",
      // NOT "No such test clock" — the object's internal name differs). Never
      // echo the request body: only Stripe's own bounded message + code.
      const code = typeof error?.code === "string" ? ` (${error.code})` : "";
      throw new Error(`stripeTestClockActor: ${message}${code}`);
    }
    return payload;
  },
};

/**
 * Builds the default transport over an injectable `StripeHttp`. Tests pass a
 * recording fake to assert the exact method+path of each call (the HTTP-contract
 * pin), without touching a real Stripe account.
 */
export function createDefaultStripeTestClockTransport(http: StripeHttp = defaultStripeHttp): StripeTestClockTransport {
  return {
    async createClock({ secretKey, frozenTimeUnix, name }) {
      const clock = await http.request(secretKey, {
        method: "POST",
        path: "/test_helpers/test_clocks",
        form: { frozen_time: String(frozenTimeUnix), name },
      });
      const testClockId = typeof clock.id === "string" ? clock.id : "";
      if (!testClockId) {
        throw new Error("stripeTestClockActor: Stripe did not return a test clock id.");
      }
      return { testClockId };
    },
    async createCustomerOnClock({ secretKey, testClockId, priceId, metadata }) {
      const customerForm: Record<string, string> = { test_clock: testClockId };
      for (const [key, value] of Object.entries(metadata)) {
        customerForm[`metadata[${key}]`] = value;
      }
      const customer = await http.request(secretKey, { method: "POST", path: "/customers", form: customerForm });
      const customerId = typeof customer.id === "string" ? customer.id : "";
      if (!customerId) {
        throw new Error("stripeTestClockActor: Stripe did not return a customer id.");
      }
      // A subscription with the default `charge_automatically` collection needs a
      // default payment method, else Stripe rejects POST /subscriptions with
      // "This customer has no attached payment source or default payment method"
      // (observed live). Attach the canonical test card + set it as the customer's
      // invoice default: create a PaymentMethod from the `tok_visa` test token,
      // attach it to the customer, then set invoice_settings[default_payment_method].
      // (test-clock customers accept a real attached test PM.)
      const paymentMethod = await http.request(secretKey, {
        method: "POST",
        path: "/payment_methods",
        form: { type: "card", "card[token]": "tok_visa" },
      });
      const paymentMethodId = typeof paymentMethod.id === "string" ? paymentMethod.id : "";
      if (!paymentMethodId) {
        throw new Error("stripeTestClockActor: Stripe did not return a payment method id.");
      }
      await http.request(secretKey, {
        method: "POST",
        path: `/payment_methods/${paymentMethodId}/attach`,
        form: { customer: customerId },
      });
      await http.request(secretKey, {
        method: "POST",
        path: `/customers/${customerId}`,
        form: { "invoice_settings[default_payment_method]": paymentMethodId },
      });
      const subscription = await http.request(secretKey, {
        method: "POST",
        path: "/subscriptions",
        form: { customer: customerId, "items[0][price]": priceId },
      });
      const subscriptionId = typeof subscription.id === "string" ? subscription.id : "";
      if (!subscriptionId) {
        throw new Error("stripeTestClockActor: Stripe did not return a subscription id.");
      }
      return { customerId, subscriptionId };
    },
    async advance({ secretKey, testClockId, toUnix }) {
      await http.request(secretKey, {
        method: "POST",
        path: `/test_helpers/test_clocks/${testClockId}/advance`,
        form: { frozen_time: String(toUnix) },
      });
      // The renewal invoice is created by the advance; the caller correlates it
      // from the server's processed webhook. Stripe's advance response does not
      // inline the invoice id, so we surface a best-effort marker the scenario
      // reconciles against the candidate Server's invoice record.
      return { invoiceId: `advance:${testClockId}:${toUnix}` };
    },
    async deleteClock({ secretKey, testClockId }) {
      // Stripe's real contract is DELETE /v1/test_helpers/test_clocks/{id}
      // (NOT a POST .../delete). Deleting the clock cascades its customers/
      // subscriptions. Idempotent: a missing clock is a clean release.
      try {
        await http.request(secretKey, { method: "DELETE", path: `/test_helpers/test_clocks/${testClockId}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Tolerate already-deleted: match Stripe's structured `resource_missing`
        // code (now appended by the HTTP seam) OR either human phrasing — a gone
        // test clock reports "No such billingclock" (the object's internal name),
        // NOT "No such test clock".
        if (!/resource_missing|No such (test clock|billingclock)/i.test(message)) {
          throw error;
        }
      }
    },
    async deleteCustomer({ secretKey, customerId }) {
      // DELETE /v1/customers/{id}. Idempotent: if the clock delete already
      // cascaded this customer away, Stripe answers resource_missing.
      try {
        await http.request(secretKey, { method: "DELETE", path: `/customers/${customerId}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/No such customer|resource_missing/i.test(message)) {
          throw error;
        }
      }
    },
    async findTestClockByName({ secretKey, name }) {
      // Cursor-paginated list (GET /v1/test_helpers/test_clocks): follow
      // has_more/starting_after until the run-owned clock is found or the
      // collection is exhausted. "Not on the first page" is NOT "not found".
      let startingAfter: string | undefined;
      for (;;) {
        const q = startingAfter ? `&starting_after=${startingAfter}` : "";
        const page = await http.request(secretKey, {
          method: "GET",
          path: `/test_helpers/test_clocks?limit=100${q}`,
        });
        const data = Array.isArray(page.data) ? (page.data as Array<Record<string, unknown>>) : [];
        const match = data.find((c) => c.name === name && typeof c.id === "string");
        if (match) {
          return { testClockId: match.id as string };
        }
        if (page.has_more === true && data.length > 0) {
          const last = data[data.length - 1];
          startingAfter = typeof last.id === "string" ? last.id : undefined;
          if (startingAfter) {
            continue;
          }
        }
        return null; // exhausted without a match.
      }
    },
    async findCustomerOnClock({ secretKey, testClockId, runTag }) {
      // Strongly-consistent, clock-SCOPED cursor-paginated LIST
      // (GET /v1/customers?test_clock=<id>) — never Search (read-after-write
      // lagged). Filter the run-owned customer by the run-tag metadata.
      let startingAfter: string | undefined;
      for (;;) {
        const q = startingAfter ? `&starting_after=${startingAfter}` : "";
        const page = await http.request(secretKey, {
          method: "GET",
          path: `/customers?test_clock=${testClockId}&limit=100${q}`,
        });
        const data = Array.isArray(page.data) ? (page.data as Array<Record<string, unknown>>) : [];
        const match = data.find(
          (c) =>
            typeof c.id === "string" &&
            typeof c.metadata === "object" &&
            c.metadata !== null &&
            (c.metadata as Record<string, unknown>).proliferate_qualification_run === runTag,
        );
        if (match) {
          return { customerId: match.id as string };
        }
        if (page.has_more === true && data.length > 0) {
          const last = data[data.length - 1];
          startingAfter = typeof last.id === "string" ? last.id : undefined;
          if (startingAfter) {
            continue;
          }
        }
        return null;
      }
    },
  };
}

export const defaultStripeTestClockTransport: StripeTestClockTransport = createDefaultStripeTestClockTransport();

// ---------------------------------------------------------------------------
// Default billing-subject bind seam — on-box product store functions
// ---------------------------------------------------------------------------

const RESOLVE_BILLING_SUBJECT_PY = `import asyncio, json, os
from uuid import UUID
from proliferate.db.engine import async_session_factory
from proliferate.db.store.billing_subjects import (
    ensure_personal_billing_subject,
    ensure_organization_billing_subject,
)

OWNER_SCOPE = os.environ["SEED_OWNER_SCOPE"]


async def main():
    async with async_session_factory() as db:
        if OWNER_SCOPE == "organization":
            subject = await ensure_organization_billing_subject(db, UUID(os.environ["SEED_ORG_ID"]))
        else:
            subject = await ensure_personal_billing_subject(db, UUID(os.environ["SEED_USER_ID"]))
        await db.commit()
        print(json.dumps({"billing_subject_id": str(subject.id)}))


asyncio.run(main())
`;

const BIND_STRIPE_CUSTOMER_PY = `import asyncio, json, os
from uuid import UUID
from proliferate.db.engine import async_session_factory
from proliferate.db.store.billing_subjects import set_billing_subject_stripe_customer


async def main():
    async with async_session_factory() as db:
        await set_billing_subject_stripe_customer(
            db,
            billing_subject_id=UUID(os.environ["SEED_BILLING_SUBJECT_ID"]),
            stripe_customer_id=os.environ["SEED_CUSTOMER_ID"],
        )
        await db.commit()
    print(json.dumps({"bound": True}))


asyncio.run(main())
`;

/**
 * Default bind seam: runs the product's own billing-subject store functions on
 * the candidate box. Throws if the world exposes no box-exec seam (the binding
 * is a DB write there is no public endpoint for).
 */
export const defaultBillingSubjectBindSeam: BillingSubjectBindSeam = {
  async resolveBillingSubjectId(world, params) {
    if (!world.box) {
      throw new Error(
        "stripeTestClockActor: the managed-cloud world exposes no box-exec seam; resolving the actor's billing " +
          "subject must run the product's own store functions on the candidate box.",
      );
    }
    const env: Record<string, string> = {
      SEED_OWNER_SCOPE: params.ownerScope,
      SEED_USER_ID: params.userId,
    };
    if (params.organizationId) {
      env.SEED_ORG_ID = params.organizationId;
    }
    const result = await world.box.serverPython(RESOLVE_BILLING_SUBJECT_PY, {
      env,
      scriptName: "resolve-billing-subject.py",
    });
    const parsed = parseLastJsonLine(result.stdout) as { billing_subject_id?: unknown };
    if (typeof parsed.billing_subject_id !== "string" || !parsed.billing_subject_id) {
      throw new Error(
        `stripeTestClockActor: the candidate box did not report a billing subject id ` +
          `(stdout: ${result.stdout.trim().slice(0, 200)}).`,
      );
    }
    return { billingSubjectId: parsed.billing_subject_id };
  },
  async bindStripeCustomer(world, params) {
    if (!world.box) {
      throw new Error(
        "stripeTestClockActor: the managed-cloud world exposes no box-exec seam; binding the Stripe customer must " +
          "run the product's own store function on the candidate box.",
      );
    }
    const result = await world.box.serverPython(BIND_STRIPE_CUSTOMER_PY, {
      env: { SEED_BILLING_SUBJECT_ID: params.billingSubjectId, SEED_CUSTOMER_ID: params.customerId },
      scriptName: "bind-stripe-customer.py",
    });
    const parsed = parseLastJsonLine(result.stdout) as { bound?: unknown };
    if (parsed.bound !== true) {
      throw new Error(
        `stripeTestClockActor: the candidate box did not confirm the Stripe customer binding ` +
          `(stdout: ${result.stdout.trim().slice(0, 200)}).`,
      );
    }
  },
};
