import {
  defaultStripeHttp,
  isLiveModeSecretKey,
  type StripeHttp,
} from "../../fixtures/stripe-test-clock.js";

const MAX_PAGES = 1_000;

function assertTestMode(secretKey: string): void {
  if (!secretKey.trim()) {
    throw new Error("Stripe test secret key is required.");
  }
  if (isLiveModeSecretKey(secretKey)) {
    throw new Error("Managed-cloud hard-cancel cleanup refuses a live-mode Stripe key.");
  }
}

function metadataOwnsRun(row: Record<string, unknown>, runTag: string): boolean {
  if (row.metadata === undefined) return false;
  if (!row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) {
    throw new Error("Stripe returned malformed resource metadata; ownership is ambiguous.");
  }
  return (row.metadata as Record<string, unknown>).proliferate_qualification_run === runTag;
}

/** Exhausts one Stripe cursor-paginated collection or fails closed. */
export async function listHardCancelStripeRows(
  secretKey: string,
  basePath: string,
  http: StripeHttp = defaultStripeHttp,
): Promise<Array<Record<string, unknown>>> {
  assertTestMode(secretKey);
  const separator = basePath.includes("?") ? "&" : "?";
  const rows: Array<Record<string, unknown>> = [];
  const seenCursors = new Set<string>();
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const cursor = startingAfter
      ? `&starting_after=${encodeURIComponent(startingAfter)}`
      : "";
    const response = await http.request(secretKey, {
      method: "GET",
      path: `${basePath}${separator}limit=100${cursor}`,
    });
    if (!Array.isArray(response.data) || typeof response.has_more !== "boolean") {
      throw new Error(`Stripe list ${basePath} returned a malformed page.`);
    }
    const data = response.data as Array<Record<string, unknown>>;
    if (data.some((row) => !row || typeof row !== "object" || typeof row.id !== "string" || !row.id)) {
      throw new Error(`Stripe list ${basePath} returned a row without an id.`);
    }
    rows.push(...data);
    if (!response.has_more) return rows;
    const next = data.at(-1)?.id as string | undefined;
    if (!next || seenCursors.has(next)) {
      throw new Error(`Stripe list ${basePath} did not advance its cursor.`);
    }
    seenCursors.add(next);
    startingAfter = next;
  }
  throw new Error(`Stripe list ${basePath} exceeded the bounded page limit.`);
}

async function deleteExactResource(
  secretKey: string,
  resourcePath: string,
  http: StripeHttp,
): Promise<void> {
  try {
    await http.request(secretKey, { method: "DELETE", path: resourcePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/resource_missing|No such (customer|webhook endpoint|endpoint)/i.test(message)) {
      throw error;
    }
  }
}

async function ownedIds(
  secretKey: string,
  path: string,
  runTag: string,
  http: StripeHttp,
): Promise<string[]> {
  const rows = await listHardCancelStripeRows(secretKey, path, http);
  return rows.flatMap((row) => metadataOwnsRun(row, runTag) ? [row.id as string] : []);
}

/** Deletes exact run-tagged webhook endpoints and then proves absence. */
export async function deleteHardCancelWebhookEndpoints(
  params: { secretKey: string; runTag: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<number> {
  const ids = await ownedIds(params.secretKey, "/webhook_endpoints", params.runTag, http);
  for (const id of ids) {
    await deleteExactResource(params.secretKey, `/webhook_endpoints/${id}`, http);
  }
  const remaining = await ownedIds(params.secretKey, "/webhook_endpoints", params.runTag, http);
  if (remaining.length > 0) {
    throw new Error(`Stripe retained ${remaining.length} exact run-owned webhook endpoint(s).`);
  }
  return ids.length;
}

/** Deletes exact run-tagged customers and then proves absence. */
export async function deleteHardCancelCustomers(
  params: { secretKey: string; runTag: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<number> {
  const ids = await ownedIds(params.secretKey, "/customers", params.runTag, http);
  for (const id of ids) {
    await deleteExactResource(params.secretKey, `/customers/${id}`, http);
  }
  const remaining = await ownedIds(params.secretKey, "/customers", params.runTag, http);
  if (remaining.length > 0) {
    throw new Error(`Stripe retained ${remaining.length} exact run-owned customer(s).`);
  }
  return ids.length;
}

interface ProductFamily {
  productId: string;
  productActive: boolean;
  activePriceIds: string[];
}

async function ownedProductFamilies(
  params: { secretKey: string; runTag: string },
  http: StripeHttp,
): Promise<ProductFamily[]> {
  const products = await listHardCancelStripeRows(params.secretKey, "/products", http);
  const owned = products.filter((row) => metadataOwnsRun(row, params.runTag));
  const result: ProductFamily[] = [];
  for (const product of owned) {
    const productId = product.id as string;
    if (typeof product.active !== "boolean") {
      throw new Error(`Stripe product ${productId} returned no boolean active state.`);
    }
    const prices = await listHardCancelStripeRows(
      params.secretKey,
      `/prices?product=${encodeURIComponent(productId)}`,
      http,
    );
    if (prices.some((price) => typeof price.active !== "boolean")) {
      throw new Error(`Stripe prices for product ${productId} returned no boolean active state.`);
    }
    if (prices.some((price) => !metadataOwnsRun(price, params.runTag))) {
      throw new Error(
        `Stripe product ${productId} has a price without exact run ownership; refusing to mutate the family.`,
      );
    }
    result.push({
      productId,
      productActive: product.active,
      activePriceIds: prices.filter((price) => price.active).map((price) => price.id as string),
    });
  }
  return result;
}

/** Archives exact run-owned active prices/products, then proves zero remain active. */
export async function deactivateHardCancelProductFamilies(
  params: { secretKey: string; runTag: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<{ matched: number; touched: number }> {
  const families = await ownedProductFamilies(params, http);
  let touched = 0;
  for (const family of families) {
    for (const priceId of family.activePriceIds) {
      await http.request(params.secretKey, {
        method: "POST",
        path: `/prices/${priceId}`,
        form: { active: "false" },
      });
      touched += 1;
    }
    if (family.productActive) {
      await http.request(params.secretKey, {
        method: "POST",
        path: `/products/${family.productId}`,
        form: { active: "false" },
      });
      touched += 1;
    }
  }
  const remaining = await ownedProductFamilies(params, http);
  const active = remaining.reduce(
    (count, family) => count + (family.productActive ? 1 : 0) + family.activePriceIds.length,
    0,
  );
  if (active > 0) {
    throw new Error(`Stripe retained ${active} active exact run-owned product/price resource(s).`);
  }
  return { matched: families.length, touched };
}

/** Counts exact-name test clocks using the exhaustive hard-cancel paginator. */
export async function countHardCancelTestClocks(
  params: { secretKey: string; name: string },
  http: StripeHttp = defaultStripeHttp,
): Promise<number> {
  const rows = await listHardCancelStripeRows(
    params.secretKey,
    "/test_helpers/test_clocks",
    http,
  );
  return rows.filter((row) => row.name === params.name).length;
}
