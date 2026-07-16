import { BillingHttpClient, isStripeLiveModeUrl, isStripeTestModeUrl, type BillingOverview } from "./billing-http.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";

/**
 * The Core funding fixture (spec "Fixtures — Core funding fixture"). The actor
 * must be explicitly Core-funded so the compute gate ADMITS provisioning. This
 * fixture only establishes that prerequisite state; it must NOT fabricate the
 * provisioning behavior itself (the sandbox create, the running interval, the
 * turn — all remain behavior under test).
 *
 * Two paths, in preference order:
 *   1. `stripe_checkout` (PREFERRED): the existing `tests/release` Stripe
 *      test-mode checkout fixtures (src/fixtures/billing.ts / billing-http.ts)
 *      adapted to this world — a real test-mode checkout that grants the Core
 *      entitlement through the real billing path.
 *   2. `entitlement_seed` (FALLBACK, disclosed): a server-side entitlement seed,
 *      acceptable FOR THIS PROVISIONING PROOF ONLY when the checkout path is
 *      impractical inside the isolated candidate world. The real free-actor gate
 *      and checkout journeys are PR 6 / PR 4 property. Every seeded run sets
 *      `disclosed: true` so the PR body/evidence records it.
 *
 * Resolution when no `method` is pinned: try `stripe_checkout`; fall back to the
 * disclosed `entitlement_seed` ONLY when the checkout path signals it is
 * impractical (`CheckoutCompletionUnavailableError`). Any OTHER checkout error —
 * notably a LIVE-mode Stripe URL, which is a real posture regression the
 * qualification world must never mint — propagates and is never masked by the
 * fallback. After either path, the compute gate is CONFIRMED (verified, not
 * assumed) within a bounded wait before the fixture returns.
 */

export type CoreFundingMethod = "stripe_checkout" | "entitlement_seed";

export interface CoreFundingResult {
  /** The billing subject the entitlement landed on (safe id). */
  billingSubjectId: string;
  /** Which path granted the entitlement. */
  method: CoreFundingMethod;
  /** True whenever the fallback seed was used — must surface in the PR body. */
  disclosed: boolean;
  /** Whether the compute gate now admits provisioning (verified, not assumed). */
  computeGateAdmits: true;
}

export interface CoreFundingOptions {
  /**
   * Forces a path. Default is `undefined` (try `stripe_checkout`, fall back to
   * `entitlement_seed` only when checkout is impractical). A run may pin
   * `entitlement_seed` explicitly (disclosed) when Stripe test mode is
   * unavailable in the world. A pinned `stripe_checkout` does NOT fall back —
   * pinning asserts the real path works, so its failure is a failure.
   */
  method?: CoreFundingMethod;
  /** Bounded wait for the entitlement to become effective (default 60s). */
  timeoutMs?: number;
  /** Poll interval while waiting for the compute gate to admit (default 2s). */
  pollMs?: number;
}

/**
 * Every side effect this fixture performs, factored out so unit tests fake the
 * billing/entitlement transport without a real Stripe or server call. The
 * default is production wiring.
 */
export interface CoreFundingTransport {
  /**
   * Runs a real Stripe test-mode checkout that grants Core; resolves the
   * subject. Throws `CheckoutCompletionUnavailableError` when the checkout was
   * minted and verified test-mode but cannot be COMPLETED headlessly in the
   * isolated candidate world (the spec-acknowledged impracticality) — that
   * marker, and only that marker, triggers the disclosed seed fallback.
   */
  runStripeCheckout(world: ManagedCloudWorld, actor: AuthenticatedActor): Promise<{ billingSubjectId: string }>;
  /** Server-side entitlement seed (disclosed fallback); resolves the subject. */
  seedEntitlement(world: ManagedCloudWorld, actor: AuthenticatedActor): Promise<{ billingSubjectId: string }>;
  /** Confirms the compute gate admits provisioning for this actor. */
  confirmComputeGate(world: ManagedCloudWorld, actor: AuthenticatedActor): Promise<boolean>;
}

export const DEFAULT_CORE_FUNDING_TIMEOUT_MS = 60_000;
export const DEFAULT_CORE_FUNDING_POLL_MS = 2_000;

/**
 * Raised when the Stripe test-mode checkout was minted and verified test-mode
 * but completing the hosted Checkout Session headlessly inside the isolated
 * candidate world is impractical (spec "Fixtures — Core funding"). This is the
 * ONLY signal that authorizes the disclosed `entitlement_seed` fallback; a
 * different checkout error (e.g. a live-mode URL) is a real bug and propagates.
 */
export class CheckoutCompletionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutCompletionUnavailableError";
  }
}

/**
 * Raised when the disclosed server-side entitlement seed has no injected
 * transport. The seed must be executed against the candidate API box (it holds
 * the billing DB; there is no public "grant Core" endpoint). The scenario /
 * integrator injects a `CoreFundingTransport.seedEntitlement` that reaches the
 * box; the fixture deliberately does not fabricate funding.
 */
export class EntitlementSeedNotWiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementSeedNotWiredError";
  }
}

/**
 * Fails closed on a Stripe URL that is not unambiguously test-mode. A LIVE-mode
 * URL is a posture regression the qualification world must never produce (the
 * exact blocker T3-BILL-3's finding #4 recorded); a non-test, non-live URL is an
 * unrecognized shape we refuse to trust. Neither is a "checkout impractical"
 * condition, so neither triggers the seed fallback.
 */
export function assertCheckoutUrlTestMode(url: string): void {
  if (isStripeLiveModeUrl(url)) {
    throw new Error(
      `coreFunding: the candidate billing surface minted a LIVE-mode Stripe URL (${url}); the qualification ` +
        "world must run Stripe in test mode. Refusing to fund against a live account.",
    );
  }
  if (!isStripeTestModeUrl(url)) {
    throw new Error(`coreFunding: expected a test-mode Stripe checkout/portal URL, got an unrecognized URL (${url}).`);
  }
}

/**
 * Core-funds the actor, preferring the real Stripe test-mode checkout and
 * falling back to the disclosed entitlement seed only when checkout is
 * impractical, then confirms the compute gate admits provisioning within a
 * bounded wait. Returns the funding record (with `disclosed`).
 */
export async function coreFunding(
  world: ManagedCloudWorld,
  actor: AuthenticatedActor,
  options: CoreFundingOptions = {},
  transport: CoreFundingTransport = defaultCoreFundingTransport,
): Promise<CoreFundingResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CORE_FUNDING_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_CORE_FUNDING_POLL_MS;

  const funded = await grantCoreFunding(world, actor, options.method, transport);

  const admits = await waitForComputeGate(world, actor, transport, { timeoutMs, pollMs });
  if (!admits) {
    throw new Error(
      `coreFunding: the compute gate did not admit provisioning within ${timeoutMs}ms after ${funded.method} ` +
        `funding (subject ${funded.billingSubjectId}). The entitlement never became effective — do not proceed ` +
        "to provisioning against an unfunded gate.",
    );
  }

  return {
    billingSubjectId: funded.billingSubjectId,
    method: funded.method,
    disclosed: funded.disclosed,
    computeGateAdmits: true,
  };
}

interface GrantedFunding {
  billingSubjectId: string;
  method: CoreFundingMethod;
  disclosed: boolean;
}

async function grantCoreFunding(
  world: ManagedCloudWorld,
  actor: AuthenticatedActor,
  method: CoreFundingMethod | undefined,
  transport: CoreFundingTransport,
): Promise<GrantedFunding> {
  if (method === "entitlement_seed") {
    const { billingSubjectId } = await transport.seedEntitlement(world, actor);
    return { billingSubjectId, method: "entitlement_seed", disclosed: true };
  }
  if (method === "stripe_checkout") {
    // Pinned: assert the real path; do NOT fall back if it is impractical.
    const { billingSubjectId } = await transport.runStripeCheckout(world, actor);
    return { billingSubjectId, method: "stripe_checkout", disclosed: false };
  }

  // Auto: prefer the real checkout; fall back to the disclosed seed ONLY when
  // the checkout signals it is impractical. Any other error propagates.
  try {
    const { billingSubjectId } = await transport.runStripeCheckout(world, actor);
    return { billingSubjectId, method: "stripe_checkout", disclosed: false };
  } catch (error) {
    if (!(error instanceof CheckoutCompletionUnavailableError)) {
      throw error;
    }
    const { billingSubjectId } = await transport.seedEntitlement(world, actor);
    return { billingSubjectId, method: "entitlement_seed", disclosed: true };
  }
}

async function waitForComputeGate(
  world: ManagedCloudWorld,
  actor: AuthenticatedActor,
  transport: CoreFundingTransport,
  options: { timeoutMs: number; pollMs: number },
): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (await transport.confirmComputeGate(world, actor)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(options.pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Production wiring. Reachable against the public candidate billing surface:
 *   - `runStripeCheckout` mints a real checkout, asserts test-mode posture, and
 *     then signals `CheckoutCompletionUnavailableError` (completing the hosted
 *     Stripe page headlessly in the isolated world is impractical — spec) so the
 *     auto path falls back to the disclosed seed;
 *   - `confirmComputeGate` reads the actor's real billing overview.
 * `seedEntitlement` is intentionally not wired here — the disclosed server-side
 * grant must run on the candidate box; the scenario injects it.
 */
export const defaultCoreFundingTransport: CoreFundingTransport = {
  async runStripeCheckout(world, actor) {
    const billing = new BillingHttpClient(world.api.baseUrl, actor.session.access_token);
    const { url } = await billing.cloudCheckout({ ownerScope: "personal" });
    // Proves posture; a live-mode regression throws here and is NOT caught by
    // the fallback (it is not a CheckoutCompletionUnavailableError).
    assertCheckoutUrlTestMode(url);
    throw new CheckoutCompletionUnavailableError(
      "coreFunding: a Stripe TEST-mode checkout was minted and verified test-mode, but completing the hosted " +
        "Checkout Session headlessly inside the isolated candidate world is impractical (spec 'Fixtures — Core " +
        "funding'). Falling back to the disclosed server-side entitlement seed. Inject a " +
        "CoreFundingTransport.runStripeCheckout that completes the checkout (PR 4 billing machinery) to exercise " +
        "the real path.",
    );
  },
  async seedEntitlement() {
    throw new EntitlementSeedNotWiredError(
      "defaultCoreFundingTransport.seedEntitlement: the disclosed server-side Core entitlement grant must be " +
        "executed on the candidate API box (it holds the billing DB; there is no public grant endpoint). Inject a " +
        "CoreFundingTransport.seedEntitlement that runs the grant on the box (via the world's server-side seam) — " +
        "this fixture deliberately does not fabricate funding.",
    );
  },
  async confirmComputeGate(world, actor) {
    const billing = new BillingHttpClient(world.api.baseUrl, actor.session.access_token);
    const overview = await billing.overview({ ownerScope: "personal" });
    return computeGateAdmits(overview);
  },
};

/**
 * Whether the compute gate ADMITS provisioning for this actor — the actual
 * admission signal, not a payment-posture proxy. A Core-funded actor is admitted
 * when the start is not blocked AND it has usable cloud hours: either a positive
 * `remainingHours` balance, OR unlimited cloud hours (a healthy subscription or
 * an active unlimited-cloud entitlement, under which the server reports
 * `remainingHours: null`). Checking `isPaidCloud` alone would wrongly reject the
 * spec-sanctioned server-side unlimited-cloud entitlement seed (which is a real
 * product row granting unlimited hours but is not a Stripe subscription), so the
 * gate reads unlimited-vs-balance directly. Integrator-approved change; the real
 * Core-via-checkout funding posture is PR 4 / PR 6 property.
 */
export function computeGateAdmits(overview: BillingOverview): boolean {
  if (overview.startBlocked) {
    return false;
  }
  if (overview.hasUnlimitedCloudHours) {
    return true;
  }
  return typeof overview.remainingHours === "number" && overview.remainingHours > 0;
}
