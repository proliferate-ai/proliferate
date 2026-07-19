import {
  defaultStripeHttp,
  isLiveModeSecretKey,
  STRIPE_INTENT_RECOVERY_WINDOW_MS,
  StripeIntentStillPropagatingError,
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
  params: { secretKey: string; url: string; runTag?: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<{ endpointId: string } | null> {
  const matches = await findWebhookEndpointsByUrl(params, http);
  return matches[0] ?? null;
}

/** Exhaustive exact-url/run-tag lookup used by interruption cleanup. */
export async function findWebhookEndpointsByUrl(
  params: { secretKey: string; url: string; runTag?: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<Array<{ endpointId: string }>> {
  assertTestMode(params.secretKey);
  const rows = await listStripeRowsStrict(params.secretKey, "/webhook_endpoints", http);
  return rows.filter((entry) => {
    if (entry.url !== params.url || typeof entry.id !== "string") {
      return false;
    }
    if (!params.runTag) {
      return true;
    }
    const metadata = entry.metadata as Record<string, unknown> | undefined;
    return metadata?.proliferate_qualification_run === params.runTag;
  }).map((entry) => ({ endpointId: entry.id as string }));
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
  // Provider acceptance is not cleanup truth. Re-read both exact resources and
  // fail if Stripe still reports either one active. A missing resource is an
  // idempotent clean outcome; malformed responses stay ambiguous/non-green.
  await assertProductPriceInactive(secretKey, productId, priceId, http);
}

async function assertProductPriceInactive(
  secretKey: string,
  productId: string,
  priceId: string,
  http: StripeHttp,
): Promise<void> {
  const assertInactive = async (kind: "product" | "price", id: string): Promise<void> => {
    if (!id) {
      return;
    }
    try {
      const row = await http.request(secretKey, { method: "GET", path: `/${kind}s/${id}` });
      if (typeof row.active !== "boolean") {
        throw new Error(`Stripe ${kind} ${id} returned no boolean active state after cleanup.`);
      }
      if (row.active) {
        throw new Error(`Stripe ${kind} ${id} remained active after cleanup.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/No such (price|product)|resource_missing/i.test(message)) {
        throw error;
      }
    }
  };
  await assertInactive("price", priceId);
  await assertInactive("product", productId);
}

/**
 * Finds every run-owned product and its prices from strongly scoped, exhaustive
 * Stripe LIST calls. This is the recovery path for the two-call
 * product→price→ledger-acquire window: a product may exist even when no price
 * was returned to the caller. Provider ambiguity throws rather than becoming an
 * empty/clean result.
 */
export async function findRunProductPrices(
  params: { secretKey: string; runTag: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<Array<{ productId: string; productActive: boolean; priceIds: string[]; activePriceIds: string[] }>> {
  assertTestMode(params.secretKey);
  const products = await listStripeRowsStrict(params.secretKey, "/products", http);
  const owned = products.filter((row) => {
    if (typeof row.metadata !== "object" || row.metadata === null || Array.isArray(row.metadata)) {
      throw new Error("Stripe product list returned malformed metadata; refusing to classify ownership.");
    }
    const metadata = row.metadata as Record<string, unknown>;
    return typeof row.id === "string" && metadata?.proliferate_qualification_run === params.runTag;
  });
  const result: Array<{ productId: string; productActive: boolean; priceIds: string[]; activePriceIds: string[] }> = [];
  for (const product of owned) {
    const productId = product.id as string;
    if (typeof product.active !== "boolean") {
      throw new Error(`Stripe product ${productId} returned no boolean active state.`);
    }
    const prices = await listStripeRowsStrict(
      params.secretKey,
      `/prices?product=${encodeURIComponent(productId)}`,
      http,
    );
    if (prices.some((price) => typeof price.id !== "string" || !price.id || typeof price.active !== "boolean")) {
      throw new Error(`Stripe prices for product ${productId} returned malformed id/active state.`);
    }
    result.push({
      productId,
      productActive: product.active === true,
      priceIds: prices.map((price) => price.id as string),
      activePriceIds: prices.filter((price) => price.active === true).map((price) => price.id as string),
    });
  }
  return result;
}

/** Deactivates every run-owned active price, then archives each active product. */
export async function deactivateRunProductPricesByTag(
  params: { secretKey: string; runTag: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<{ matched: number; touched: number }> {
  const resources = await findRunProductPrices(params, http);
  let touched = 0;
  for (const resource of resources) {
    for (const priceId of resource.activePriceIds) {
      await http.request(params.secretKey, {
        method: "POST",
        path: `/prices/${priceId}`,
        form: { active: "false" },
      });
      touched += 1;
    }
    if (resource.productActive) {
      await http.request(params.secretKey, {
        method: "POST",
        path: `/products/${resource.productId}`,
        form: { active: "false" },
      });
      touched += 1;
    }
  }
  const remaining = await countActiveRunProductsAndPrices(params, http);
  if (remaining !== 0) {
    throw new Error(
      `Stripe still reports ${remaining} active run-owned product/price resource(s) after cleanup.`,
    );
  }
  return { matched: resources.length, touched };
}

/** Counts active run-owned products plus active run-owned prices. */
export async function countActiveRunProductsAndPrices(
  params: { secretKey: string; runTag: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<number> {
  const resources = await findRunProductPrices(params, http);
  return resources.reduce(
    (total, resource) => total + (resource.productActive ? 1 : 0) + resource.activePriceIds.length,
    0,
  );
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

/** Exhaustive run/cell-scoped customer lookup for intent-phase recovery. */
export async function findRunCustomers(
  params: { secretKey: string; runTag: string; cellTag?: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<string[]> {
  assertTestMode(params.secretKey);
  const rows = await listStripeRowsStrict(params.secretKey, "/customers", http);
  return rows.flatMap((row) => {
    const metadata = row.metadata as Record<string, unknown> | undefined;
    const owned =
      metadata?.proliferate_qualification_run === params.runTag &&
      (params.cellTag === undefined || metadata.proliferate_qualification_cell === params.cellTag);
    return owned && typeof row.id === "string" ? [row.id] : [];
  });
}

export async function deleteCustomerByIdHttp(
  secretKey: string,
  customerId: string,
  http: StripeHttp = defaultStripeHttp,
): Promise<void> {
  assertTestMode(secretKey);
  try {
    await http.request(secretKey, { method: "DELETE", path: `/customers/${customerId}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/No such customer|resource_missing/i.test(message)) {
      throw error;
    }
  }
}

/** Deletes every exact run/cell-owned customer and proves an exhaustive zero. */
export async function deleteRunCustomersByTag(
  params: { secretKey: string; runTag: string; cellTag?: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<number> {
  const customerIds = await findRunCustomers(params, http);
  for (const customerId of customerIds) {
    await deleteCustomerByIdHttp(params.secretKey, customerId, http);
  }
  const remaining = await findRunCustomers(params, http);
  if (remaining.length > 0) {
    throw new Error(`Stripe still reports ${remaining.length} exact run-owned customer(s) after cleanup.`);
  }
  return customerIds.length;
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
  const rows = await listStripeRowsStrict(secretKey, basePath, http);
  return rows.filter(predicate).length;
}

/**
 * Strict Stripe cursor paginator. A malformed list, a missing cursor on a
 * has_more page, or a repeated cursor is ambiguous provider state and fails
 * closed; none can be converted to an empty successful sweep.
 */
async function listStripeRowsStrict(
  secretKey: string,
  basePath: string,
  http: StripeHttp,
): Promise<Array<Record<string, unknown>>> {
  assertTestMode(secretKey);
  const sep = basePath.includes("?") ? "&" : "?";
  const rows: Array<Record<string, unknown>> = [];
  const seenCursors = new Set<string>();
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
    const cursor = startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : "";
    const page = await http.request(secretKey, {
      method: "GET",
      path: `${basePath}${sep}limit=100${cursor}`,
    });
    if (!Array.isArray(page.data) || typeof page.has_more !== "boolean") {
      throw new Error(`Stripe list ${basePath} returned a malformed page; refusing to classify it as empty.`);
    }
    const data = page.data as Array<Record<string, unknown>>;
    if (data.some((row) => typeof row !== "object" || row === null || typeof row.id !== "string")) {
      throw new Error(`Stripe list ${basePath} returned a row without an id; refusing ambiguous pagination.`);
    }
    rows.push(...data);
    if (!page.has_more) {
      return rows;
    }
    const next = data.at(-1)?.id as string | undefined;
    if (!next || seenCursors.has(next)) {
      throw new Error(`Stripe list ${basePath} did not advance its cursor while has_more=true.`);
    }
    seenCursors.add(next);
    startingAfter = next;
  }
  throw new Error(`Stripe list ${basePath} exceeded the bounded pagination limit.`);
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
        const found = await findWebhookEndpointsByUrl({ secretKey, url }, http);
        if (found.length > 0) {
          for (const match of found) {
            await deleteWebhookEndpointById(secretKey, match.endpointId, http);
          }
          const remaining = await findWebhookEndpointsByUrl({ secretKey, url }, http);
          if (remaining.length > 0) {
            throw new Error(
              `Stripe still reports ${remaining.length} exact-url webhook endpoint(s) after cleanup.`,
            );
          }
        } else if (intentCouldStillBePropagating(entry.createdAt)) {
          throw new StripeIntentStillPropagatingError(
            `stripe_webhook_endpoint intent for ${url} is not visible yet; leaving it unreconciled for retry.`,
          );
        }
        return;
      }
      throw new Error("stripe_webhook_endpoint cleanup entry has an unrecognized provider identity.");
    },
    stripe_product_price: async (entry) => {
      const decoded = decodeProductPriceProviderId(entry.providerId ?? "");
      if (decoded) {
        await deactivateProductPriceById(secretKey, decoded.productId, decoded.priceId, http);
        return;
      }
      const runTag = /^intent:product_price:runTag=(.+)$/.exec(entry.providerId ?? "")?.[1];
      if (runTag) {
        const cleanup = await deactivateRunProductPricesByTag({ secretKey, runTag }, http);
        if (cleanup.matched === 0 && intentCouldStillBePropagating(entry.createdAt)) {
          throw new StripeIntentStillPropagatingError(
            `stripe_product_price intent for run ${runTag} is not visible yet; leaving it unreconciled for retry.`,
          );
        }
        return;
      }
      throw new Error("stripe_product_price cleanup entry has an unrecognized provider identity.");
    },
  };
}

function intentCouldStillBePropagating(createdAt: string): boolean {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    throw new Error("Stripe cleanup entry has a malformed createdAt timestamp; refusing to reconcile it.");
  }
  return Date.now() - createdAtMs < STRIPE_INTENT_RECOVERY_WINDOW_MS;
}
