import {
  defaultStripeHttp,
  isLiveModeSecretKey,
  type StripeHttp,
} from "./stripe-test-clock.js";
import type { CleanupHandler, CleanupResourceKind } from "../worlds/local-workspace/cleanup-ledger.js";

/**
 * Run-scoped Stripe TEST-mode resource helpers for MANAGED-CLOUD-FIXTURE-SMOKE-1.
 *
 * This module extends the merged Stripe seam ONLY — it reuses the exported
 * `StripeHttp`/`defaultStripeHttp` transport from `stripe-test-clock.ts` (no
 * second Stripe client). It adds the bounded operations the fixture smoke needs
 * that the test-clock fixture does not already own:
 *
 *   - a RUN-SCOPED webhook endpoint (so a real test-mode op fires a signed
 *     delivery through the on-box relay → candidate Server);
 *   - a RUN-SCOPED product + monthly price (the test-clock cell subscribes to it);
 *   - a RUN-SCOPED bare customer (cell A's cheap `customer.created` trigger and
 *     cell E's extra replay resource);
 *   - test-mode EVENT polling (correlate the signed callback + the renewal
 *     invoice to our own object ids);
 *   - test-clock status polling (advance is async: 'advancing' → 'ready');
 *   - paginated SWEEP listers (test clocks / customers / webhook endpoints /
 *     prices) so cell E can prove zero owned resources remain;
 *   - EXPORTED ledger-replay handlers for the two new cleanup kinds
 *     (`stripe_webhook_endpoint`, `stripe_product_price`) usable with
 *     `replayLedger` from a fresh executor.
 *
 * Every function is behind the injectable `StripeHttp`, so unit tests pin the
 * EXACT method+path+form with a recording fake and never touch a real account.
 * No raw secret, whsec_, or full payload is ever returned to evidence — callers
 * carry only bounded ids and (for the webhook create) the secret straight into a
 * 0600 env file which is never serialized.
 */

/** A live-mode key must never reach these helpers (fail closed, mirrors the fixture guard). */
function assertTestMode(secretKey: string): void {
  if (isLiveModeSecretKey(secretKey)) {
    throw new Error(
      "stripe-smoke-resources: a LIVE-mode Stripe secret key was supplied (sk_live_…/rk_live_…). The " +
        "qualification world must run Stripe in test mode only.",
    );
  }
}

// ---------------------------------------------------------------------------
// Run-scoped naming (deterministic → recoverable from the ledger alone)
// ---------------------------------------------------------------------------

/** The webhook endpoint's run-scoped description (its recovery identity by url is primary). */
export function webhookDescriptionForRun(runTag: string): string {
  return `proliferate-qual-smoke-${runTag}`;
}
/** The run-scoped product name. */
export function productNameForRun(runTag: string): string {
  return `proliferate-qual-${runTag}`;
}

/** Intent refs for the two smoke-owned cleanup kinds (prefix-tagged, like the test-clock refs). */
export function encodeWebhookEndpointIntentRef(subdomain: string): string {
  return `intent:webhook_endpoint:url=${webhookEndpointUrl(subdomain)}`;
}
export function encodeProductPriceIntentRef(runTag: string): string {
  return `intent:product_price:runTag=${runTag}`;
}

/** The Server's Stripe webhook path on the run subdomain (the relay forwards here). */
export function webhookEndpointUrl(subdomain: string): string {
  return `https://${subdomain}/v1/billing/webhooks/stripe`;
}

/** A small, bounded event set incl. customer.created (cell A's cheapest trigger). */
export const SMOKE_WEBHOOK_EVENTS = [
  "customer.created",
  "invoice.paid",
  "invoice.payment_succeeded",
] as const;

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------

export interface CreatedWebhookEndpoint {
  endpointId: string;
  /** whsec_… — handed straight into a 0600 env file; NEVER serialized to evidence. */
  secret: string;
}

/** `POST /webhook_endpoints` with a bounded enabled-events set + run description. */
export async function createWebhookEndpoint(
  params: { secretKey: string; subdomain: string; runTag: string; events?: readonly string[] },
  http: StripeHttp = defaultStripeHttp,
): Promise<CreatedWebhookEndpoint> {
  assertTestMode(params.secretKey);
  const events = params.events ?? SMOKE_WEBHOOK_EVENTS;
  const form: Record<string, string> = {
    url: webhookEndpointUrl(params.subdomain),
    description: webhookDescriptionForRun(params.runTag),
    "metadata[proliferate_qualification_run]": params.runTag,
  };
  events.forEach((event, index) => {
    form[`enabled_events[${index}]`] = event;
  });
  const created = await http.request(params.secretKey, { method: "POST", path: "/webhook_endpoints", form });
  const endpointId = typeof created.id === "string" ? created.id : "";
  const secret = typeof created.secret === "string" ? created.secret : "";
  if (!endpointId || !secret) {
    throw new Error("stripe-smoke-resources: Stripe did not return a webhook endpoint id + secret.");
  }
  return { endpointId, secret };
}

/** `DELETE /webhook_endpoints/{id}` — idempotent (a missing endpoint is a clean release). */
export async function deleteWebhookEndpointById(
  secretKey: string,
  endpointId: string,
  http: StripeHttp = defaultStripeHttp,
): Promise<void> {
  assertTestMode(secretKey);
  try {
    await http.request(secretKey, { method: "DELETE", path: `/webhook_endpoints/${endpointId}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/No such (webhook )?endpoint|resource_missing/i.test(message)) {
      throw error;
    }
  }
}

/** Paginated lookup of a run-owned webhook endpoint by its exact url (recovery identity). */
export async function findWebhookEndpointByUrl(
  params: { secretKey: string; url: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<{ endpointId: string } | null> {
  assertTestMode(params.secretKey);
  let startingAfter: string | undefined;
  for (;;) {
    const q = startingAfter ? `&starting_after=${startingAfter}` : "";
    const page = await http.request(params.secretKey, {
      method: "GET",
      path: `/webhook_endpoints?limit=100${q}`,
    });
    const data = Array.isArray(page.data) ? (page.data as Array<Record<string, unknown>>) : [];
    const match = data.find((e) => e.url === params.url && typeof e.id === "string");
    if (match) {
      return { endpointId: match.id as string };
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
}

// ---------------------------------------------------------------------------
// Product + price (cell B). Stripe cannot DELETE a price → deactivate instead.
// ---------------------------------------------------------------------------

export interface CreatedProductPrice {
  productId: string;
  priceId: string;
}

/** `POST /products` then `POST /prices` (unit_amount 2000/usd/month), both run-tagged. */
export async function createRunProductPrice(
  params: { secretKey: string; runTag: string; unitAmount?: number },
  http: StripeHttp = defaultStripeHttp,
): Promise<CreatedProductPrice> {
  assertTestMode(params.secretKey);
  const product = await http.request(params.secretKey, {
    method: "POST",
    path: "/products",
    form: {
      name: productNameForRun(params.runTag),
      "metadata[proliferate_qualification_run]": params.runTag,
    },
  });
  const productId = typeof product.id === "string" ? product.id : "";
  if (!productId) {
    throw new Error("stripe-smoke-resources: Stripe did not return a product id.");
  }
  const price = await http.request(params.secretKey, {
    method: "POST",
    path: "/prices",
    form: {
      unit_amount: String(params.unitAmount ?? 2000),
      currency: "usd",
      "recurring[interval]": "month",
      product: productId,
      "metadata[proliferate_qualification_run]": params.runTag,
    },
  });
  const priceId = typeof price.id === "string" ? price.id : "";
  if (!priceId) {
    throw new Error("stripe-smoke-resources: Stripe did not return a price id.");
  }
  return { productId, priceId };
}

/**
 * Deactivates a run-owned product+price: Stripe cannot delete a price, so this
 * is a bounded DEACTIVATION of run-owned resources — `POST /prices/{id}`
 * active=false, then `POST /products/{id}` active=false (archive). Idempotent /
 * tolerant of an already-archived or missing resource. The providerId encodes
 * both ids as `<productId>/<priceId>`.
 */
export async function deactivateProductPriceById(
  secretKey: string,
  productId: string,
  priceId: string,
  http: StripeHttp = defaultStripeHttp,
): Promise<void> {
  assertTestMode(secretKey);
  const tolerate = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/No such (price|product)|resource_missing/i.test(message)) {
        throw error;
      }
    }
  };
  // Deactivate the price first (a price on an active product is the enforceable
  // resource), then archive the product.
  if (priceId) {
    await tolerate(() =>
      http.request(secretKey, { method: "POST", path: `/prices/${priceId}`, form: { active: "false" } }),
    );
  }
  if (productId) {
    await tolerate(() =>
      http.request(secretKey, { method: "POST", path: `/products/${productId}`, form: { active: "false" } }),
    );
  }
}

/** Encodes/decodes the `stripe_product_price` providerId (`<productId>/<priceId>`). */
export function encodeProductPriceProviderId(productId: string, priceId: string): string {
  return `${productId}/${priceId}`;
}
export function decodeProductPriceProviderId(providerId: string): { productId: string; priceId: string } | null {
  const match = /^(prod_[A-Za-z0-9]+)\/(price_[A-Za-z0-9]+)$/.exec(providerId);
  return match ? { productId: match[1]!, priceId: match[2]! } : null;
}

// ---------------------------------------------------------------------------
// Bare customer (cell A trigger; cell E extra replay resource)
// ---------------------------------------------------------------------------

/** `POST /customers` with a run-tag; NOT on a clock. Returns the cus_ id. */
export async function createRunCustomer(
  params: { secretKey: string; runTag: string; cellTag?: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<{ customerId: string }> {
  assertTestMode(params.secretKey);
  const form: Record<string, string> = {
    "metadata[proliferate_qualification_run]": params.runTag,
  };
  if (params.cellTag) {
    form["metadata[proliferate_qualification_cell]"] = params.cellTag;
  }
  const customer = await http.request(params.secretKey, { method: "POST", path: "/customers", form });
  const customerId = typeof customer.id === "string" ? customer.id : "";
  if (!customerId) {
    throw new Error("stripe-smoke-resources: Stripe did not return a customer id.");
  }
  return { customerId };
}

// ---------------------------------------------------------------------------
// Event polling (correlate a signed delivery / renewal to OUR object)
// ---------------------------------------------------------------------------

export interface StripeEventRow {
  id: string;
  type: string;
  /** `data.object.id` when present (the customer/invoice this event is about). */
  objectId: string | null;
  /** `data.object.customer` when present (invoices carry the customer separately). */
  customerId: string | null;
}

/** Parses `GET /events` rows into bounded correlation shapes. */
function parseEventRows(data: Array<Record<string, unknown>>): StripeEventRow[] {
  return data
    .filter((row) => typeof row.id === "string" && typeof row.type === "string")
    .map((row) => {
      const dataObj = (row.data as { object?: Record<string, unknown> } | undefined)?.object ?? {};
      return {
        id: row.id as string,
        type: row.type as string,
        objectId: typeof dataObj.id === "string" ? dataObj.id : null,
        customerId: typeof dataObj.customer === "string" ? dataObj.customer : null,
      };
    });
}

/**
 * Finds the FIRST event of `type` whose object matches `matchObjectId` (by the
 * event object's own id OR its `customer` field). Single page (limit 100) is
 * enough for a fresh run's recent events; the caller polls this bounded.
 * Returns null when not yet visible.
 */
export async function findEventForObject(
  params: { secretKey: string; type: string; matchObjectId: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<StripeEventRow | null> {
  assertTestMode(params.secretKey);
  const page = await http.request(params.secretKey, {
    method: "GET",
    path: `/events?type=${encodeURIComponent(params.type)}&limit=100`,
  });
  const rows = parseEventRows(Array.isArray(page.data) ? (page.data as Array<Record<string, unknown>>) : []);
  return (
    rows.find((row) => row.objectId === params.matchObjectId || row.customerId === params.matchObjectId) ?? null
  );
}

/**
 * Finds the first event of ANY of `types` whose object's `customer` (or id)
 * equals `matchCustomerId` — for the renewal (`invoice.paid` OR
 * `invoice.payment_succeeded`; test clocks emit one of these on a paid renewal).
 */
export async function findRenewalEventForCustomer(
  params: { secretKey: string; types: readonly string[]; matchCustomerId: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<StripeEventRow | null> {
  for (const type of params.types) {
    const found = await findEventForObject(
      { secretKey: params.secretKey, type, matchObjectId: params.matchCustomerId },
      http,
    );
    if (found) {
      return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test-clock status (advance is async: 'advancing' → 'ready')
// ---------------------------------------------------------------------------

/** `GET /test_helpers/test_clocks/{id}` → its status string, or null when missing. */
export async function getTestClockStatus(
  params: { secretKey: string; testClockId: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<{ status: string } | { missing: true }> {
  assertTestMode(params.secretKey);
  try {
    const clock = await http.request(params.secretKey, {
      method: "GET",
      path: `/test_helpers/test_clocks/${params.testClockId}`,
    });
    return { status: typeof clock.status === "string" ? clock.status : "unknown" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A gone test clock reports "No such billingclock" (internal object name),
    // not "No such test clock" — match on the structured `resource_missing`
    // code (appended by the shared HTTP seam) or either phrasing.
    if (/resource_missing|No such (test clock|billingclock)/i.test(message)) {
      return { missing: true };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Sweep listers (cell E: prove zero owned resources remain)
// ---------------------------------------------------------------------------

/** Counts run-owned test clocks by run-scoped NAME (paginated to exhaustion). */
export async function countRunTestClocks(
  params: { secretKey: string; name: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<number> {
  return countPaginated(params.secretKey, "/test_helpers/test_clocks", http, (row) => row.name === params.name);
}

/** Counts run-owned customers by run-tag metadata (paginated to exhaustion). */
export async function countRunCustomers(
  params: { secretKey: string; runTag: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<number> {
  return countPaginated(params.secretKey, "/customers", http, (row) => {
    const metadata = row.metadata as Record<string, unknown> | undefined;
    return metadata?.proliferate_qualification_run === params.runTag;
  });
}

/** Counts run-owned webhook endpoints by exact url (paginated to exhaustion). */
export async function countRunWebhookEndpoints(
  params: { secretKey: string; url: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<number> {
  return countPaginated(params.secretKey, "/webhook_endpoints", http, (row) => row.url === params.url);
}

/** Counts still-ACTIVE run-owned prices for a product (paginated). Inactive = swept. */
export async function countActiveRunPrices(
  params: { secretKey: string; productId: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<number> {
  return countPaginated(
    params.secretKey,
    `/prices?product=${params.productId}`,
    http,
    (row) => row.active === true,
  );
}

/** Shared cursor-paginated counter over a Stripe list resource. */
async function countPaginated(
  secretKey: string,
  basePath: string,
  http: StripeHttp,
  predicate: (row: Record<string, unknown>) => boolean,
): Promise<number> {
  assertTestMode(secretKey);
  const sep = basePath.includes("?") ? "&" : "?";
  let startingAfter: string | undefined;
  let count = 0;
  for (;;) {
    const q = startingAfter ? `&starting_after=${startingAfter}` : "";
    const page = await http.request(secretKey, { method: "GET", path: `${basePath}${sep}limit=100${q}` });
    const data = Array.isArray(page.data) ? (page.data as Array<Record<string, unknown>>) : [];
    for (const row of data) {
      if (predicate(row)) {
        count += 1;
      }
    }
    if (page.has_more === true && data.length > 0) {
      const last = data[data.length - 1];
      startingAfter = typeof last.id === "string" ? last.id : undefined;
      if (startingAfter) {
        continue;
      }
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Ledger-replay handlers for the two smoke-owned Stripe kinds
// ---------------------------------------------------------------------------

/**
 * Replay handlers for `stripe_webhook_endpoint` + `stripe_product_price`, usable
 * with `replayLedger` on a reloaded ledger (cell E's fresh executor). They work
 * from the ENTRY ALONE (no closures):
 *   - webhook endpoint: real `we_…` providerId → DELETE by id; intent
 *     (`intent:webhook_endpoint:url=…`) → locate by url + DELETE.
 *   - product+price: real `<prod_…>/<price_…>` providerId → deactivate both;
 *     an intent ref (no ids yet) → nothing to deactivate (never created / already
 *     gone) → clean reconcile.
 * Deletes/deactivations tolerate resource_missing, so a world-close releaser
 * running the same delete afterwards is idempotent.
 */
export function stripeSmokeResourceReplayHandlers(params: {
  secretKey: string;
  http?: StripeHttp;
}): Partial<Record<CleanupResourceKind, CleanupHandler>> {
  const http = params.http ?? defaultStripeHttp;
  const { secretKey } = params;
  return {
    stripe_webhook_endpoint: async (entry) => {
      const providerId = entry.providerId ?? "";
      if (providerId.startsWith("we_")) {
        await deleteWebhookEndpointById(secretKey, providerId, http);
        return;
      }
      const url = /^intent:webhook_endpoint:url=(.+)$/.exec(providerId)?.[1];
      if (url) {
        const found = await findWebhookEndpointByUrl({ secretKey, url }, http);
        if (found) {
          await deleteWebhookEndpointById(secretKey, found.endpointId, http);
        }
        return;
      }
      // unknown/null providerId: nothing actionable → clean reconcile.
    },
    stripe_product_price: async (entry) => {
      const decoded = decodeProductPriceProviderId(entry.providerId ?? "");
      if (decoded) {
        await deactivateProductPriceById(secretKey, decoded.productId, decoded.priceId, http);
      }
      // An intent-only ref (no real ids) means the create never landed → clean.
    },
  };
}
