import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countActiveRunProductsAndPrices,
  countActiveRunPrices,
  countRunCustomers,
  countRunTestClocks,
  countRunWebhookEndpoints,
  createRunCustomer,
  createRunProductPrice,
  createWebhookEndpoint,
  deleteRunCustomersByTag,
  deactivateProductPriceById,
  deactivateRunProductPricesByTag,
  decodeProductPriceProviderId,
  deleteWebhookEndpointById,
  encodeProductPriceProviderId,
  findEventForObject,
  findRenewalEventForCustomer,
  findRunProductPrices,
  findRunCustomers,
  findWebhookEndpointByUrl,
  getTestClockStatus,
  stripeSmokeResourceReplayHandlers,
  webhookEndpointUrl,
} from "./stripe-smoke-resources.js";
import type { StripeHttp, StripeHttpRequest } from "./stripe-test-clock.js";

interface Recorded {
  method: string;
  path: string;
  form?: Record<string, string>;
}

/** A recording StripeHttp with scripted responses keyed by exact path (or a fn). */
function recordingHttp(
  respond: (req: StripeHttpRequest) => Record<string, unknown> = () => ({}),
): { http: StripeHttp; reqs: Recorded[] } {
  const reqs: Recorded[] = [];
  const http: StripeHttp = {
    async request(_secretKey, req) {
      reqs.push({ method: req.method, path: req.path, form: req.form });
      return respond(req);
    },
  };
  return { http, reqs };
}

const KEY = "sk_test_smoke";

test("createWebhookEndpoint POSTs /webhook_endpoints with a bounded events set incl. customer.created", async () => {
  const { http, reqs } = recordingHttp(() => ({ id: "we_1", secret: "whsec_x" }));
  const created = await createWebhookEndpoint({ secretKey: KEY, subdomain: "run.qual.example", runTag: "r:s" }, http);
  assert.deepEqual(created, { endpointId: "we_1", secret: "whsec_x" });
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0]!.method, "POST");
  assert.equal(reqs[0]!.path, "/webhook_endpoints");
  assert.equal(reqs[0]!.form!.url, "https://run.qual.example/v1/billing/webhooks/stripe");
  assert.equal(reqs[0]!.form!["enabled_events[0]"], "customer.created");
  assert.equal(reqs[0]!.form!["metadata[proliferate_qualification_run]"], "r:s");
});

test("standalone callback-customer recovery filters by run and cell, deletes all matches, and verifies zero", async () => {
  let rows = [
    { id: "cus_owned_1", metadata: { proliferate_qualification_run: "r:s", proliferate_qualification_cell: "cellA" } },
    { id: "cus_owned_2", metadata: { proliferate_qualification_run: "r:s", proliferate_qualification_cell: "cellA" } },
    { id: "cus_other_cell", metadata: { proliferate_qualification_run: "r:s", proliferate_qualification_cell: "cellB" } },
  ];
  const { http } = recordingHttp((req) => {
    if (req.method === "GET" && req.path.startsWith("/customers")) {
      return { data: rows, has_more: false };
    }
    if (req.method === "DELETE" && req.path.startsWith("/customers/")) {
      const id = req.path.split("/").at(-1);
      rows = rows.filter((row) => row.id !== id);
      return { id, deleted: true };
    }
    return {};
  });
  assert.deepEqual(
    await findRunCustomers({ secretKey: KEY, runTag: "r:s", cellTag: "cellA" }, http),
    ["cus_owned_1", "cus_owned_2"],
  );
  assert.equal(
    await deleteRunCustomersByTag({ secretKey: KEY, runTag: "r:s", cellTag: "cellA" }, http),
    2,
  );
  assert.deepEqual(rows.map((row) => row.id), ["cus_other_cell"]);
});

test("createWebhookEndpoint refuses a live-mode key (fail closed)", async () => {
  const { http } = recordingHttp(() => ({ id: "we_1", secret: "whsec_x" }));
  await assert.rejects(
    () => createWebhookEndpoint({ secretKey: "sk_live_x", subdomain: "x", runTag: "r:s" }, http),
    /LIVE-mode/,
  );
});

test("deleteWebhookEndpointById is DELETE /webhook_endpoints/{id} and tolerates resource_missing", async () => {
  const { http, reqs } = recordingHttp((req) => {
    if (req.path === "/webhook_endpoints/we_gone") {
      throw new Error("stripeTestClockActor: No such webhook endpoint: resource_missing");
    }
    return {};
  });
  await deleteWebhookEndpointById(KEY, "we_1", http);
  assert.deepEqual(reqs[0], { method: "DELETE", path: "/webhook_endpoints/we_1", form: undefined });
  // resource_missing is swallowed (idempotent).
  await deleteWebhookEndpointById(KEY, "we_gone", http);
});

test("findWebhookEndpointByUrl paginates to exhaustion and matches by exact url", async () => {
  const url = webhookEndpointUrl("run.qual.example");
  let page = 0;
  const { http } = recordingHttp((req) => {
    if (!req.path.startsWith("/webhook_endpoints")) return {};
    page += 1;
    if (page === 1) {
      return { data: [{ id: "we_a", url: "https://other/v1/billing/webhooks/stripe" }], has_more: true };
    }
    return { data: [{ id: "we_b", url }], has_more: false };
  });
  const found = await findWebhookEndpointByUrl({ secretKey: KEY, url }, http);
  assert.deepEqual(found, { endpointId: "we_b" });
});

test("createRunProductPrice POSTs /products then /prices with monthly recurring usd", async () => {
  const { http, reqs } = recordingHttp((req) => (req.path === "/products" ? { id: "prod_1" } : { id: "price_1" }));
  const created = await createRunProductPrice({ secretKey: KEY, runTag: "r:s" }, http);
  assert.deepEqual(created, { productId: "prod_1", priceId: "price_1" });
  assert.equal(reqs[0]!.path, "/products");
  assert.equal(reqs[1]!.path, "/prices");
  assert.equal(reqs[1]!.form!["recurring[interval]"], "month");
  assert.equal(reqs[1]!.form!.currency, "usd");
  assert.equal(reqs[1]!.form!.product, "prod_1");
});

test("deactivateProductPriceById POSTs active=false then verifies both exact resources inactive", async () => {
  const { http, reqs } = recordingHttp((req) =>
    req.method === "GET" ? { id: req.path.split("/").at(-1), active: false } : {},
  );
  await deactivateProductPriceById(KEY, "prod_1", "price_1", http);
  assert.deepEqual(reqs, [
    { method: "POST", path: "/prices/price_1", form: { active: "false" } },
    { method: "POST", path: "/products/prod_1", form: { active: "false" } },
    { method: "GET", path: "/prices/price_1", form: undefined },
    { method: "GET", path: "/products/prod_1", form: undefined },
  ]);
});

test("deactivateProductPriceById fails when Stripe accepts deactivation but still reports active", async () => {
  const { http } = recordingHttp((req) => (req.method === "GET" ? { active: true } : {}));
  await assert.rejects(
    () => deactivateProductPriceById(KEY, "prod_1", "price_1", http),
    /remained active/,
  );
});

test("product/price provider-id encode/decode round-trips", () => {
  const encoded = encodeProductPriceProviderId("prod_1", "price_1");
  assert.equal(encoded, "prod_1/price_1");
  assert.deepEqual(decodeProductPriceProviderId(encoded), { productId: "prod_1", priceId: "price_1" });
  assert.equal(decodeProductPriceProviderId("intent:product_price:runTag=r:s"), null);
});

test("createRunCustomer POSTs /customers with the run tag + optional cell tag", async () => {
  const { http, reqs } = recordingHttp(() => ({ id: "cus_1" }));
  const created = await createRunCustomer({ secretKey: KEY, runTag: "r:s", cellTag: "cellA" }, http);
  assert.equal(created.customerId, "cus_1");
  assert.equal(reqs[0]!.form!["metadata[proliferate_qualification_run]"], "r:s");
  assert.equal(reqs[0]!.form!["metadata[proliferate_qualification_cell]"], "cellA");
});

test("findEventForObject correlates a customer.created event by the object id", async () => {
  const { http } = recordingHttp(() => ({
    data: [
      { id: "evt_other", type: "customer.created", data: { object: { id: "cus_other" } } },
      { id: "evt_1", type: "customer.created", data: { object: { id: "cus_1" } } },
    ],
  }));
  const found = await findEventForObject({ secretKey: KEY, type: "customer.created", matchObjectId: "cus_1" }, http);
  assert.equal(found?.id, "evt_1");
});

test("findRenewalEventForCustomer matches by the invoice's customer field across event types", async () => {
  const { http } = recordingHttp((req) => {
    if (req.path.includes("invoice.payment_succeeded")) {
      return { data: [{ id: "evt_r", type: "invoice.payment_succeeded", data: { object: { id: "in_1", customer: "cus_1" } } }] };
    }
    return { data: [] };
  });
  const found = await findRenewalEventForCustomer(
    { secretKey: KEY, types: ["invoice.paid", "invoice.payment_succeeded"], matchCustomerId: "cus_1" },
    http,
  );
  assert.equal(found?.id, "evt_r");
});

test("getTestClockStatus returns the status, or {missing:true} on resource_missing", async () => {
  const { http } = recordingHttp((req) => {
    if (req.path.endsWith("tc_gone")) {
      throw new Error("stripeTestClockActor: No such test clock: resource_missing");
    }
    return { status: "ready" };
  });
  assert.deepEqual(await getTestClockStatus({ secretKey: KEY, testClockId: "tc_1" }, http), { status: "ready" });
  assert.deepEqual(await getTestClockStatus({ secretKey: KEY, testClockId: "tc_gone" }, http), { missing: true });
});

test("sweep counters count run-owned resources and follow pagination", async () => {
  const { http } = recordingHttp((req) => {
    if (req.path.startsWith("/test_helpers/test_clocks")) {
      return { data: [{ id: "tc_1", name: "proliferate-qual-renew-r:s" }, { id: "tc_x", name: "other" }], has_more: false };
    }
    if (req.path.startsWith("/customers")) {
      return { data: [{ id: "cus_1", metadata: { proliferate_qualification_run: "r:s" } }], has_more: false };
    }
    if (req.path.startsWith("/webhook_endpoints")) {
      return { data: [{ id: "we_1", url: webhookEndpointUrl("run.qual.example") }], has_more: false };
    }
    if (req.path.startsWith("/prices")) {
      return { data: [{ id: "price_1", active: false }, { id: "price_2", active: true }], has_more: false };
    }
    return {};
  });
  assert.equal(await countRunTestClocks({ secretKey: KEY, name: "proliferate-qual-renew-r:s" }, http), 1);
  assert.equal(await countRunCustomers({ secretKey: KEY, runTag: "r:s" }, http), 1);
  assert.equal(await countRunWebhookEndpoints({ secretKey: KEY, url: webhookEndpointUrl("run.qual.example") }, http), 1);
  assert.equal(await countActiveRunPrices({ secretKey: KEY, productId: "prod_1" }, http), 1);
});

test("run-tag recovery finds product-only interruption, deactivates it, and verifies zero active", async () => {
  let productActive = true;
  const { http, reqs } = recordingHttp((req) => {
    if (req.method === "GET" && req.path.startsWith("/products")) {
      return {
        data: [{ id: "prod_leaked", active: productActive, metadata: { proliferate_qualification_run: "r:s" } }],
        has_more: false,
      };
    }
    if (req.method === "GET" && req.path.startsWith("/prices?product=")) {
      return { data: [], has_more: false };
    }
    if (req.method === "POST" && req.path === "/products/prod_leaked") {
      productActive = false;
      return { id: "prod_leaked", active: false };
    }
    return {};
  });
  assert.deepEqual(await findRunProductPrices({ secretKey: KEY, runTag: "r:s" }, http), [
    { productId: "prod_leaked", productActive: true, priceIds: [], activePriceIds: [] },
  ]);
  assert.deepEqual(await deactivateRunProductPricesByTag({ secretKey: KEY, runTag: "r:s" }, http), {
    matched: 1,
    touched: 1,
  });
  assert.equal(await countActiveRunProductsAndPrices({ secretKey: KEY, runTag: "r:s" }, http), 0);
  assert.ok(reqs.some((req) => req.method === "POST" && req.path === "/products/prod_leaked"));
});

test("run-tag product recovery fails closed on malformed active state", async () => {
  const { http } = recordingHttp((req) => {
    if (req.path.startsWith("/products")) {
      return {
        data: [{ id: "prod_1", metadata: { proliferate_qualification_run: "r:s" } }],
        has_more: false,
      };
    }
    return { data: [], has_more: false };
  });
  await assert.rejects(() => findRunProductPrices({ secretKey: KEY, runTag: "r:s" }, http), /boolean active/);
});

test("strict Stripe pagination rejects a repeated cursor instead of classifying the sweep empty", async () => {
  const { http } = recordingHttp(() => ({
    data: [{ id: "cus_repeat", metadata: { proliferate_qualification_run: "other" } }],
    has_more: true,
  }));
  await assert.rejects(() => countRunCustomers({ secretKey: KEY, runTag: "r:s" }, http), /did not advance/);
});

test("replay handlers delete a real webhook endpoint by id and deactivate a real product+price", async () => {
  const { http, reqs } = recordingHttp((req) =>
    req.method === "GET" ? { id: req.path.split("/").at(-1), active: false } : {},
  );
  const handlers = stripeSmokeResourceReplayHandlers({ secretKey: KEY, http });
  await handlers.stripe_webhook_endpoint!({
    entryId: "e1",
    kind: "stripe_webhook_endpoint",
    phase: "acquired",
    providerId: "we_1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await handlers.stripe_product_price!({
    entryId: "e2",
    kind: "stripe_product_price",
    phase: "acquired",
    providerId: "prod_1/price_1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.ok(reqs.some((r) => r.method === "DELETE" && r.path === "/webhook_endpoints/we_1"));
  assert.ok(reqs.some((r) => r.path === "/prices/price_1" && r.form?.active === "false"));
  assert.ok(reqs.some((r) => r.path === "/products/prod_1" && r.form?.active === "false"));
});

test("replay handler recovers a webhook endpoint from an intent url when the real id was never acquired", async () => {
  const url = webhookEndpointUrl("run.qual.example");
  let endpointIds = ["we_found"];
  const { http, reqs } = recordingHttp((req) => {
    if (req.method === "GET" && req.path.startsWith("/webhook_endpoints")) {
      return { data: endpointIds.map((id) => ({ id, url })), has_more: false };
    }
    if (req.method === "DELETE" && req.path.startsWith("/webhook_endpoints/")) {
      const id = req.path.split("/").at(-1);
      endpointIds = endpointIds.filter((candidate) => candidate !== id);
      return { id, deleted: true };
    }
    return {};
  });
  const handlers = stripeSmokeResourceReplayHandlers({ secretKey: KEY, http });
  await handlers.stripe_webhook_endpoint!({
    entryId: "e1",
    kind: "stripe_webhook_endpoint",
    phase: "intent",
    providerId: `intent:webhook_endpoint:url=${url}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.ok(reqs.some((r) => r.method === "DELETE" && r.path === "/webhook_endpoints/we_found"));
  assert.deepEqual(endpointIds, []);
});

test("webhook intent replay deletes every duplicate exact-url match and verifies exhaustive absence", async () => {
  const url = webhookEndpointUrl("duplicate.qual.example");
  let endpointIds = ["we_duplicate_1", "we_duplicate_2"];
  const { http, reqs } = recordingHttp((req) => {
    if (req.method === "GET" && req.path.startsWith("/webhook_endpoints")) {
      return { data: endpointIds.map((id) => ({ id, url })), has_more: false };
    }
    if (req.method === "DELETE" && req.path.startsWith("/webhook_endpoints/")) {
      const id = req.path.split("/").at(-1);
      endpointIds = endpointIds.filter((candidate) => candidate !== id);
      return { id, deleted: true };
    }
    return {};
  });
  const handlers = stripeSmokeResourceReplayHandlers({ secretKey: KEY, http });
  await handlers.stripe_webhook_endpoint!({
    entryId: "e-duplicates",
    kind: "stripe_webhook_endpoint",
    phase: "intent",
    providerId: `intent:webhook_endpoint:url=${url}`,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  });
  assert.deepEqual(endpointIds, []);
  assert.equal(reqs.filter((req) => req.method === "DELETE").length, 2);
  assert.ok(reqs.filter((req) => req.method === "GET").length >= 2, "cleanup must re-list after deletion");
});

test("replay handler recovers a product accepted before price/acquire and proves it inactive", async () => {
  let active = true;
  const { http } = recordingHttp((req) => {
    if (req.method === "GET" && req.path.startsWith("/products")) {
      return {
        data: [{ id: "prod_partial", active, metadata: { proliferate_qualification_run: "r:s" } }],
        has_more: false,
      };
    }
    if (req.method === "GET" && req.path.startsWith("/prices?product=")) {
      return { data: [], has_more: false };
    }
    if (req.method === "POST" && req.path === "/products/prod_partial") {
      active = false;
      return { id: "prod_partial", active: false };
    }
    return {};
  });
  const handlers = stripeSmokeResourceReplayHandlers({ secretKey: KEY, http });
  await handlers.stripe_product_price!({
    entryId: "e-product-intent",
    kind: "stripe_product_price",
    phase: "intent",
    providerId: "intent:product_price:runTag=r:s",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  });
  assert.equal(active, false);
});
