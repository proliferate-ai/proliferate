import assert from "node:assert/strict";
import { test } from "node:test";

import type { StripeHttp, StripeHttpRequest } from "../../fixtures/stripe-test-clock.js";
import {
  deactivateHardCancelProductFamilies,
  deleteHardCancelCustomers,
  deleteHardCancelWebhookEndpoints,
  listHardCancelStripeRows,
} from "./hard-cancel-stripe.js";

const KEY = "sk_test_hard_cancel";

function recordingHttp(
  respond: (request: StripeHttpRequest) => Record<string, unknown>,
): { http: StripeHttp; requests: StripeHttpRequest[] } {
  const requests: StripeHttpRequest[] = [];
  return {
    requests,
    http: {
      async request(_secretKey, request) {
        requests.push(request);
        return respond(request);
      },
    },
  };
}

test("paginates to exhaustion and deletes only exact run-owned resources", async () => {
  const runTag = "qlc-ci-42-1:1";
  let rows = [
    { id: "we_owned_1", metadata: { proliferate_qualification_run: runTag } },
    { id: "we_foreign", metadata: { proliferate_qualification_run: "other:1" } },
    { id: "we_owned_2", metadata: { proliferate_qualification_run: runTag } },
  ];
  const fake = recordingHttp((request) => {
    if (request.method === "GET") {
      return request.path.includes("starting_after=we_foreign")
        ? { data: rows.filter((row) => row.id === "we_owned_2"), has_more: false }
        : { data: rows.filter((row) => row.id !== "we_owned_2"), has_more: rows.length === 3 };
    }
    const id = request.path.split("/").at(-1);
    rows = rows.filter((row) => row.id !== id);
    return { deleted: true };
  });

  assert.equal(await deleteHardCancelWebhookEndpoints({ secretKey: KEY, runTag }, fake.http), 2);
  assert.deepEqual(rows.map((row) => row.id), ["we_foreign"]);
  assert.deepEqual(
    fake.requests.filter((request) => request.method === "DELETE").map((request) => request.path),
    ["/webhook_endpoints/we_owned_1", "/webhook_endpoints/we_owned_2"],
  );
});

test("retained exact-owned resources keep cleanup red", async () => {
  const fake = recordingHttp((request) => request.method === "GET"
    ? {
        data: [{ id: "cus_owned", metadata: { proliferate_qualification_run: "r:1" } }],
        has_more: false,
      }
    : { deleted: true });
  await assert.rejects(
    () => deleteHardCancelCustomers({ secretKey: KEY, runTag: "r:1" }, fake.http),
    /retained 1 exact run-owned customer/,
  );
});

test("product/price cleanup deactivates exact-owned families and proves zero active", async () => {
  const runTag = "r:1";
  let products = [
    { id: "prod_owned", active: true, metadata: { proliferate_qualification_run: runTag } },
    { id: "prod_foreign", active: true, metadata: { proliferate_qualification_run: "other:1" } },
  ];
  let prices = [
    { id: "price_owned", active: true, product: "prod_owned" },
    { id: "price_foreign", active: true, product: "prod_foreign" },
  ];
  const fake = recordingHttp((request) => {
    const path = request.path.split("?")[0]!;
    if (request.method === "GET" && path === "/products") return { data: products, has_more: false };
    if (request.method === "GET" && path === "/prices") {
      const product = new URLSearchParams(request.path.split("?")[1]).get("product");
      return { data: prices.filter((price) => price.product === product), has_more: false };
    }
    if (request.method === "POST" && path.startsWith("/prices/")) {
      const id = path.split("/").at(-1);
      prices = prices.map((price) => price.id === id ? { ...price, active: false } : price);
      return { active: false };
    }
    if (request.method === "POST" && path.startsWith("/products/")) {
      const id = path.split("/").at(-1);
      products = products.map((product) => product.id === id ? { ...product, active: false } : product);
      return { active: false };
    }
    throw new Error(`unexpected request ${request.method} ${request.path}`);
  });

  assert.deepEqual(
    await deactivateHardCancelProductFamilies({ secretKey: KEY, runTag }, fake.http),
    { matched: 1, touched: 2 },
  );
  assert.equal(products.find((row) => row.id === "prod_owned")?.active, false);
  assert.equal(products.find((row) => row.id === "prod_foreign")?.active, true);
  assert.equal(prices.find((row) => row.id === "price_owned")?.active, false);
  assert.equal(prices.find((row) => row.id === "price_foreign")?.active, true);
});

test("malformed or nonadvancing provider pages fail closed", async () => {
  const malformed: StripeHttp = { async request() { return { data: [], has_more: "yes" }; } };
  await assert.rejects(() => listHardCancelStripeRows(KEY, "/customers", malformed), /malformed page/);

  const repeated: StripeHttp = {
    async request() { return { data: [{ id: "same" }], has_more: true }; },
  };
  await assert.rejects(() => listHardCancelStripeRows(KEY, "/customers", repeated), /did not advance/);
});
