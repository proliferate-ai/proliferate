import assert from "node:assert/strict";
import test from "node:test";

import {
  ALERTMANAGER_CONFIG,
  WORKSPACE_BASE_URL,
  createGrafanaClient,
} from "./grafana-client.mjs";
import {
  emptyPlan,
  fixtureFetch,
  publicFixture,
  twoPageCompletePlan,
} from "./grafana-client.inventory.fixtures.mjs";

function datasource(uid) {
  return { uid, name: uid, type: "cloudwatch", access: "proxy", isDefault: false, readOnly: true };
}

function maximalPlan() {
  const plan = emptyPlan();
  const sources = Array.from({ length: 16 }, (_, index) => datasource(`ds${index}`));
  plan.set("/api/datasources", sources);
  for (const type of ["dash-folder", "dash-db"]) {
    for (let page = 1; page <= 5; page += 1) {
      plan.set(`/api/search?type=${type}&limit=100&page=${page}`,
        Array.from({ length: page === 5 ? 99 : 100 }, (_, index) => ({
          type,
          uid: `${type}-${page}-${index}`,
          title: `${page}-${index}`,
        })));
    }
  }
  for (let page = 1; page <= 5; page += 1) {
    plan.set(`/api/serviceaccounts/search?perpage=100&page=${page}`, {
      serviceAccounts: Array.from({ length: 100 }, (_, index) => ({ id: (page - 1) * 100 + index + 1,
        name: `${page}-${index}`, role: "Viewer", isDisabled: false, tokens: 0 })),
      page, perPage: 100, totalCount: 500,
    });
  }
  for (const source of sources) plan.set(`/api/datasources/uid/${source.uid}/health`, { status: "OK" });
  return plan;
}

test("public method wires the full fixed plan with one bearer and no mutation", async () => {
  const contexts = [];
  const token = "one-principal-token";
  const { client, trace } = publicFixture(twoPageCompletePlan(), { token,
    tokenProvider(context) { contexts.push(context); return token; } });
  for (const name of ["upsertAlertRule", "postAlertmanagerConfig"]) {
    client[name] = async () => { throw new Error(`inventory invoked mutation ${name}`); };
  }
  const result = await client.readMetadataInventory();
  assert.equal(contexts.length, 1);
  assert.equal(result.surfaces.datasourceHealth.itemCount, 2);
  assert.deepEqual(trace.map((entry) => entry.path), [
    "/api/health",
    "/api/datasources",
    "/api/search?type=dash-folder&limit=100&page=1",
    "/api/search?type=dash-folder&limit=100&page=2",
    "/api/search?type=dash-db&limit=100&page=1",
    "/api/search?type=dash-db&limit=100&page=2",
    "/api/ruler/grafana/api/v1/rules",
    "/api/v1/provisioning/contact-points",
    "/api/v1/provisioning/policies",
    "/api/access-control/user/permissions",
    "/api/serviceaccounts/search?perpage=100&page=1",
    "/api/serviceaccounts/search?perpage=100&page=2",
    "/api/datasources/uid/z/health",
    "/api/datasources/uid/%C3%A9/health",
  ]);
  assert.ok(trace.every((entry) => entry.method === "GET" && entry.redirect === "manual" &&
    !entry.hasBody && !entry.mutationHeader && entry.authorizationPresent && entry.authorizationEqual));
  assert.equal(JSON.stringify({ result, trace }).includes(token), false);
});

test("the maximal legitimate plan is exactly 37 sequential requests", async () => {
  const contexts = [];
  const { client, trace } = publicFixture(maximalPlan(), {
    tokenProvider(context) { contexts.push(context); return "inventory-token"; },
  });
  const result = await client.readMetadataInventory();
  assert.equal(contexts.length, 1);
  assert.equal(trace.length, 37);
  assert.equal(result.surfaces.folders.itemCount, 499);
  assert.equal(result.surfaces.dashboards.itemCount, 499);
  assert.equal(result.surfaces.serviceAccounts.itemCount, 500);
  assert.equal(result.surfaces.datasourceHealth.itemCount, 16);
  assert.equal(trace[0].path, "/api/health");
  assert.equal(trace[20].path, "/api/serviceaccounts/search?perpage=100&page=5");
  const healthPaths = Array.from({ length: 16 }, (_, index) => `/api/datasources/uid/ds${index}/health`).sort();
  assert.deepEqual(trace.slice(21).map((entry) => entry.path), healthPaths);
  assert.ok(trace.every((entry) => entry.authorizationPresent && entry.authorizationEqual));
});

test("the redacted fixture rejects request 38 explicitly", async () => {
  const trace = [];
  const fetchImpl = fixtureFetch(emptyPlan(), { trace });
  const request = () => fetchImpl(`${WORKSPACE_BASE_URL}/api/health`, {
    method: "GET",
    headers: { Authorization: "Bearer inventory-token" },
    redirect: "manual",
  });
  for (let count = 0; count < 37; count += 1) await request();
  await assert.rejects(request(), /request 38/);
  assert.equal(trace.length, 38);
});

test("client retains the exact existing public method set plus inventory", () => {
  const { client } = publicFixture();
  assert.deepEqual(Object.keys(client).sort(), [
    "getAlertRule",
    "getAlertmanagerConfig",
    "getContactPoints",
    "getNotificationPolicy",
    "listAlertRules",
    "listAlertRulesViaRuler",
    "postAlertmanagerConfig",
    "readMetadataInventory",
    "upsertAlertRule",
  ]);
});

test("legacy methods still call tokenProvider synchronously with zero arguments once per request", async () => {
  const providerCalls = [];
  const requests = [];
  let providerCalled = false;
  const client = createGrafanaClient({
    tokenProvider(...args) { providerCalled = true; providerCalls.push(args); return "legacy-token"; },
    fetchImpl: async (url, init) => {
      assert.equal(providerCalled, true);
      requests.push({ url, init });
      return { ok: true, status: 200, text: async () => "[]" };
    },
  });
  await client.listAlertRules();
  providerCalled = false;
  await client.listAlertRulesViaRuler();
  providerCalled = false;
  await client.getAlertRule("uid");
  providerCalled = false;
  await client.getContactPoints();
  providerCalled = false;
  await client.getNotificationPolicy();
  providerCalled = false;
  await client.upsertAlertRule("uid", { uid: "uid" });
  providerCalled = false;
  await client.getAlertmanagerConfig();
  providerCalled = false;
  await client.postAlertmanagerConfig({});
  assert.deepEqual(providerCalls.map((args) => args.length), Array(8).fill(0));
  assert.equal(requests.length, 8);
  assert.ok(requests.every(({ url, init }) => url.startsWith(`${WORKSPACE_BASE_URL}/api/`) &&
    init.redirect === "manual" && init.headers.Authorization === "Bearer legacy-token"));
});

test("a legacy write refuses 307 without following or leaking target or token", async () => {
  const calls = [];
  const client = createGrafanaClient({ tokenProvider: () => "write-token-sentinel",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: false, status: 307, text: async () => "hostile-body" };
    } });
  await assert.rejects(client.upsertAlertRule("uid", { uid: "uid" }), (error) => {
    assert.equal(error.message, "Grafana PUT /api/v1/provisioning/alert-rules/uid failed with HTTP 307");
    assert.equal(error.message.includes("write-token-sentinel"), false);
    assert.equal(error.message.includes("amazonaws"), false);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers["X-Disable-Provenance"], "true");
});

test("legacy Alertmanager path and inventory remain disjoint", async () => {
  const calls = [];
  const client = createGrafanaClient({ tokenProvider: () => "legacy",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "{}" };
    } });
  await client.getAlertmanagerConfig();
  assert.equal(new URL(calls[0].url).pathname, ALERTMANAGER_CONFIG);
  assert.equal(calls[0].init.method, "GET");
});
