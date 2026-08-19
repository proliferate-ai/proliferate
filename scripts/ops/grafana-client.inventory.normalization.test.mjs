import assert from "node:assert/strict";
import test from "node:test";

import { readMetadataInventoryInternal } from "./grafana-metadata-inventory.mjs";
import {
  INVENTORY_TARGET,
  completePlan,
  controlledRuntime,
  emptyPlan,
  fixtureFetch,
  internalPrepare,
  rawResponse,
  surfaceFailure,
} from "./grafana-client.inventory.fixtures.mjs";

async function runPlan(plan = emptyPlan(), runtime = controlledRuntime()) {
  const trace = [];
  const fetchImpl = fixtureFetch(plan, { trace });
  const result = await readMetadataInventoryInternal({ target: INVENTORY_TARGET,
    prepareAuthorizedGet: internalPrepare(fetchImpl), productionClockAndTimers: runtime.dependencies });
  return { result, trace, runtime };
}

function datasource(uid, overrides = {}) {
  return { uid, name: `name-${uid}`, type: "cloudwatch", access: "proxy",
    isDefault: false, readOnly: true, ...overrides };
}

function searchItem(type, uid, overrides = {}) {
  return { type, uid, title: `title-${uid}`, ...overrides };
}

function serviceAccount(id, overrides = {}) {
  return { id, name: `name-${id}`, role: "Viewer", isDisabled: false, tokens: 0, ...overrides };
}

function setSearchPages(plan, type, pages) {
  for (let index = 0; index < pages.length; index += 1) {
    plan.set(`/api/search?type=${type}&limit=100&page=${index + 1}`, pages[index]);
  }
}

function setServicePages(plan, pages) {
  for (let index = 0; index < pages.length; index += 1) {
    plan.set(`/api/serviceaccounts/search?perpage=100&page=${index + 1}`, pages[index]);
  }
}

test("complete projection is exact, canonically ordered, and privacy-negative", async () => {
  const { result, trace } = await runPlan(completePlan());
  assert.deepEqual(result.target, INVENTORY_TARGET);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, "grafana_metadata_inventory");
  assert.equal(result.queriedAt, "2026-08-19T00:00:00.000Z");
  assert.deepEqual(result.freshness, { state: "unknown", sourceTimestamp: null, expectedWithinMs: null,
    reason: "no_authoritative_configuration_freshness_contract" });
  assert.equal(result.appliedLimits.requestCount, 37);
  assert.deepEqual(result.surfaces.datasources.items.map((item) => item.uid), ["z", "é"]);
  assert.deepEqual(result.surfaces.folders.items.map((item) => item.uid), ["f1", "f2"]);
  assert.deepEqual(result.surfaces.dashboards.items, [
    { uid: "d1", title: "Nested", folderUid: "f1" },
    { uid: "d2", title: "Root", folderUid: null },
  ]);
  assert.deepEqual(result.surfaces.alertRules.items[0], { uid: "r1", title: "Rule", folderUid: "f1",
    ruleGroup: "g", isPaused: false, noDataState: "NoData", execErrState: "Error",
    labelKeys: ["alpha", "severity"], annotationKeys: ["runbook"] });
  assert.deepEqual(result.surfaces.contactPoints.items[0].settingKeys, ["alpha", "beta"]);
  assert.deepEqual(result.surfaces.notificationPolicy.items[0], {
    rootReceiver: "root", receiverNames: ["child", "root"], routeCount: 3, maxDepth: 1,
  });
  assert.deepEqual(result.surfaces.callerPermissions.items, [
    { action: "datasources:read", scopeCount: 2 },
    { action: "serviceaccounts:read", scopeCount: 1 },
  ]);
  assert.deepEqual(result.surfaces.serviceAccounts.items.map((item) => item.id), [1, 2]);
  assert.deepEqual(result.surfaces.datasourceHealth.items, [
    { uid: "z", state: "ok" },
    { uid: "é", state: "unavailable", reason: "datasource_health_failed", httpStatus: 200 },
  ]);
  const serialized = JSON.stringify({ result, trace });
  for (const forbidden of ["forbidden-url", "forbidden-token", "forbidden-query", "forbidden-value",
    "forbidden-setting", "forbidden-secret", "forbidden-password", "forbidden-matcher",
    "forbidden-scope", "forbidden-login", "forbidden-plugin-message", "forbidden-health-prose"] ) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("complete visible zero collections remain genuine empty, not unavailable", async () => {
  const { result } = await runPlan();
  for (const name of ["datasources", "datasourceHealth", "folders", "dashboards", "alertRules",
    "contactPoints", "callerPermissions", "serviceAccounts"]) {
    assert.deepEqual(result.surfaces[name], { state: "empty", itemCount: 0, items: [] });
  }
  assert.equal(result.surfaces.api.state, "ok");
  assert.equal(result.surfaces.notificationPolicy.state, "ok");
});

test("managed API health cases are independent and version metadata never gates later surfaces", async (t) => {
  const cases = [
    ["missing version", { database: "ok" }, { version: null, versionMatchesExpected: null }],
    ["matching version", { database: "ok", version: "10.4.7" }, { version: "10.4.7", versionMatchesExpected: true }],
    ["future version", { database: "ok", version: "11.0.0" }, { version: "11.0.0", versionMatchesExpected: false }],
  ];
  for (const [name, body, expected] of cases) {
    await t.test(name, async () => {
      const plan = emptyPlan(); plan.set("/api/health", body);
      const { result } = await runPlan(plan);
      assert.deepEqual(result.surfaces.api.items[0], { databaseOk: true, ...expected });
      assert.equal(result.surfaces.datasources.state, "empty");
    });
  }
  for (const [body, expected] of [
    [{ database: "not-ok", version: 3 }, surfaceFailure("unavailable", "api_database_not_ok", 200)],
    [{ version: "10.4" }, surfaceFailure("malformed", "invalid_shape", 200)],
    [{ database: 1 }, surfaceFailure("malformed", "invalid_shape", 200)],
    [{ database: "ok", version: null }, surfaceFailure("malformed", "invalid_shape", 200)],
  ]) {
    const plan = emptyPlan(); plan.set("/api/health", body);
    const { result } = await runPlan(plan);
    assert.deepEqual(result.surfaces.api, expected);
    assert.equal(result.surfaces.datasources.state, "empty");
  }
});

test("search pagination stops on a short page and a full fifth page fails without page six", async () => {
  const plan = emptyPlan();
  setSearchPages(plan, "dash-folder", [
    Array.from({ length: 100 }, (_, index) => searchItem("dash-folder", `f${index}`)),
    [searchItem("dash-folder", "last")],
  ]);
  const normal = await runPlan(plan);
  assert.equal(normal.result.surfaces.folders.itemCount, 101);
  assert.equal(normal.trace.some((entry) => entry.path.endsWith("page=3") && entry.path.includes("dash-folder")), false);

  const capped = emptyPlan();
  setSearchPages(capped, "dash-db", Array.from({ length: 5 }, (_, page) =>
    Array.from({ length: 100 }, (_, index) => searchItem("dash-db", `d${page}-${index}`))));
  const limited = await runPlan(capped);
  assert.deepEqual(limited.result.surfaces.dashboards, surfaceFailure("unknown", "page_limit", 200));
  assert.equal(limited.trace.some((entry) => entry.path.endsWith("page=6")), false);
});

test("service-account transition completes on equality and never invents page six", async (t) => {
  const cases = [
    { name: "full first equality", pages: [{ serviceAccounts: Array.from({ length: 100 }, (_, i) => serviceAccount(i + 1)),
      page: 1, perPage: 100, totalCount: 100 }], state: "ok", requests: 1 },
    { name: "two page", pages: [
      { serviceAccounts: Array.from({ length: 100 }, (_, i) => serviceAccount(i + 1)), page: 1, perPage: 100, totalCount: 101 },
      { serviceAccounts: [serviceAccount(101)], page: 2, perPage: 100, totalCount: 101 },
    ], state: "ok", requests: 2 },
    { name: "short below total", pages: [{ serviceAccounts: [serviceAccount(1)], page: 1, perPage: 100, totalCount: 2 }],
      reason: "invalid_shape", requests: 1 },
    { name: "greater than total", pages: [{ serviceAccounts: [serviceAccount(1), serviceAccount(2)], page: 1,
      perPage: 100, totalCount: 1 }], reason: "invalid_shape", requests: 1 },
    { name: "total item bound", pages: [{ serviceAccounts: [], page: 1, perPage: 100, totalCount: 501 }],
      reason: "item_limit", requests: 1 },
    { name: "invalid echo before item bound", pages: [{ serviceAccounts: [], page: 2, perPage: 100, totalCount: 501 }],
      reason: "invalid_shape", requests: 1 },
    { name: "within page duplicate", pages: [{ serviceAccounts: [serviceAccount(1), serviceAccount(1)], page: 1,
      perPage: 100, totalCount: 2 }], reason: "invalid_shape", requests: 1 },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const plan = emptyPlan(); setServicePages(plan, fixture.pages);
      const { result, trace } = await runPlan(plan);
      const service = result.surfaces.serviceAccounts;
      if (fixture.state) assert.equal(service.state, fixture.state);
      else assert.deepEqual(service, surfaceFailure(fixture.reason === "item_limit" ? "unknown" : "malformed",
        fixture.reason, 200));
      assert.equal(trace.filter((entry) => entry.path.startsWith("/api/serviceaccounts/search")).length, fixture.requests);
      assert.equal(trace.some((entry) => entry.path.endsWith("page=6")), false);
    });
  }
});

test("service accounts accept exact 500 and reject page-five incompleteness and cross-page duplicates", async () => {
  const exact = emptyPlan();
  setServicePages(exact, Array.from({ length: 5 }, (_, page) => ({
    serviceAccounts: Array.from({ length: 100 }, (_, index) => serviceAccount(page * 100 + index + 1)),
    page: page + 1, perPage: 100, totalCount: 500,
  })));
  assert.equal((await runPlan(exact)).result.surfaces.serviceAccounts.itemCount, 500);

  const incomplete = emptyPlan();
  setServicePages(incomplete, Array.from({ length: 5 }, (_, page) => ({
    serviceAccounts: Array.from({ length: page === 4 ? 99 : 100 }, (_, index) => serviceAccount(page * 100 + index + 1)),
    page: page + 1, perPage: 100, totalCount: 500,
  })));
  assert.deepEqual((await runPlan(incomplete)).result.surfaces.serviceAccounts,
    surfaceFailure("malformed", "invalid_shape", 200));

  const duplicate = emptyPlan();
  setServicePages(duplicate, [
    { serviceAccounts: Array.from({ length: 100 }, (_, i) => serviceAccount(i + 1)), page: 1, perPage: 100, totalCount: 101 },
    { serviceAccounts: [serviceAccount(1)], page: 2, perPage: 100, totalCount: 101 },
  ]);
  assert.deepEqual((await runPlan(duplicate)).result.surfaces.serviceAccounts,
    surfaceFailure("malformed", "invalid_shape", 200));
});

test("parsed precedence matrix selects the numbered higher row", async (t) => {
  const cases = [
    { name: "row4 item before duplicate/string", expectedRow: 4, surface: "datasources", state: "unknown", reason: "item_limit",
      mutate(plan) { plan.set("/api/datasources", Array.from({ length: 501 }, (_, i) => datasource(i < 2 ? "dup" : `d${i}`,
        { name: "x".repeat(257) }))); } },
    { name: "row6 key before invalid key", expectedRow: 6, surface: "contactPoints", state: "unknown", reason: "key_limit",
      mutate(plan) { const settings = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i]));
        settings["\ud800"] = 1; plan.set("/api/v1/provisioning/contact-points",
          [{ uid: "c", name: "n", type: "x", settings }]); } },
    { name: "row7 duplicate before string", expectedRow: 7, surface: "datasources", state: "malformed", reason: "invalid_shape",
      mutate(plan) { plan.set("/api/datasources", [datasource("dup"), datasource("dup", { name: "x".repeat(257) })]); } },
    { name: "row2 database before bad version", expectedRow: 2, surface: "api", state: "unavailable", reason: "api_database_not_ok",
      mutate(plan) { plan.set("/api/health", { database: "bad", version: 3 }); } },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      assert.ok([2, 4, 6, 7].includes(fixture.expectedRow));
      const plan = emptyPlan(); fixture.mutate(plan);
      const { result } = await runPlan(plan);
      assert.deepEqual(result.surfaces[fixture.surface], surfaceFailure(fixture.state, fixture.reason, 200));
    });
  }
});

test("policy item/depth precedence and exact boundaries are deterministic", async () => {
  const overItems = { receiver: "root", routes: Array.from({ length: 500 }, () => ({ receiver: 3 })) };
  const itemPlan = emptyPlan(); itemPlan.set("/api/v1/provisioning/policies", overItems);
  assert.deepEqual((await runPlan(itemPlan)).result.surfaces.notificationPolicy,
    surfaceFailure("unknown", "item_limit", 200));

  let deep = { receiver: 3 };
  for (let depth = 0; depth < 33; depth += 1) deep = { receiver: "ok", routes: [deep] };
  const depthPlan = emptyPlan(); depthPlan.set("/api/v1/provisioning/policies", deep);
  assert.deepEqual((await runPlan(depthPlan)).result.surfaces.notificationPolicy,
    surfaceFailure("unknown", "depth_limit", 200));

  const exact = { receiver: "root", routes: Array.from({ length: 499 }, (_, i) => ({ receiver: `r${i}` })) };
  const exactPlan = emptyPlan(); exactPlan.set("/api/v1/provisioning/policies", exact);
  assert.equal((await runPlan(exactPlan)).result.surfaces.notificationPolicy.items[0].routeCount, 500);
});

test("Unicode, path, number, duplicate, and string limits fail closed before fan-out", async (t) => {
  const cases = [
    ["lone high UID", datasource("\ud800")],
    ["lone low name", datasource("ok", { name: "\udfff" })],
    ["unsafe path", datasource("../bad")],
    ["one-over string", datasource("ok", { name: "x".repeat(257) })],
  ];
  for (const [name, item] of cases) {
    await t.test(name, async () => {
      const plan = emptyPlan(); plan.set("/api/datasources", [item]);
      const { result, trace } = await runPlan(plan);
      assert.equal(result.surfaces.datasources.state, "malformed");
      assert.equal(trace.some((entry) => entry.path.includes("/health")), false);
    });
  }
  for (const account of [serviceAccount(Number.MAX_SAFE_INTEGER + 1),
    serviceAccount(1, { tokens: Number.MAX_SAFE_INTEGER + 1 }), serviceAccount(1, { tokens: -1 })]) {
    const plan = emptyPlan(); setServicePages(plan, [{ serviceAccounts: [account], page: 1, perPage: 100, totalCount: 1 }]);
    assert.deepEqual((await runPlan(plan)).result.surfaces.serviceAccounts,
      surfaceFailure("malformed", "invalid_shape", 200));
  }
});

test("provider map insertion order cannot change traversal output", async () => {
  const a = emptyPlan();
  const b = emptyPlan();
  a.set("/api/access-control/user/permissions", { "serviceaccounts:read": [1], "datasources:read": [1, 2] });
  b.set("/api/access-control/user/permissions", { "datasources:read": [1, 2], "serviceaccounts:read": [1] });
  const left = (await runPlan(a)).result.surfaces.callerPermissions;
  const right = (await runPlan(b)).result.surfaces.callerPermissions;
  assert.deepEqual(left, right);
  assert.equal(JSON.stringify(left), JSON.stringify(right));
});

test("all object collections reject repeated identities instead of de-duplicating", async (t) => {
  const fixtures = [
    ["datasources", "/api/datasources", [datasource("dup"), datasource("dup")]],
    ["contactPoints", "/api/v1/provisioning/contact-points", [
      { uid: "dup", name: "a", type: "x", settings: {} },
      { uid: "dup", name: "b", type: "x", settings: {} },
    ]],
    ["alertRules", "/api/ruler/grafana/api/v1/rules", { n: [{ rules: [
      { grafana_alert: { uid: "dup", title: "a" } },
      { grafana_alert: { uid: "dup", title: "b" } },
    ] }] }],
  ];
  for (const [surface, path, payload] of fixtures) {
    await t.test(surface, async () => {
      const plan = emptyPlan(); plan.set(path, payload);
      assert.deepEqual((await runPlan(plan)).result.surfaces[surface],
        surfaceFailure("malformed", "invalid_shape", 200));
    });
  }
});

test("dynamic-key and health-string row 7/8 boundaries are exact", async () => {
  const badKey = emptyPlan(); badKey.set("/api/v1/provisioning/contact-points",
    [{ uid: "c", name: "n", type: "x", settings: { ["k".repeat(257)]: "ignored" } }]);
  assert.deepEqual((await runPlan(badKey)).result.surfaces.contactPoints,
    surfaceFailure("malformed", "string_limit", 200));
  const missing = completePlan(); missing.set("/api/datasources/uid/z/health",
    { message: "x".repeat(257) });
  assert.deepEqual((await runPlan(missing)).result.surfaces.datasourceHealth.items[0],
    { uid: "z", state: "malformed", reason: "invalid_shape", httpStatus: 200 });
  const oversized = completePlan(); oversized.set("/api/datasources/uid/z/health",
    { status: "x".repeat(257), message: "ignored" });
  assert.deepEqual((await runPlan(oversized)).result.surfaces.datasourceHealth.items[0],
    { uid: "z", state: "malformed", reason: "string_limit", httpStatus: 200 });
});

test("maximum safe service-account numbers are preserved exactly", async () => {
  const plan = emptyPlan();
  setServicePages(plan, [{ serviceAccounts: [serviceAccount(Number.MAX_SAFE_INTEGER,
    { tokens: Number.MAX_SAFE_INTEGER })], page: 1, perPage: 100, totalCount: 1 }]);
  assert.deepEqual((await runPlan(plan)).result.surfaces.serviceAccounts.items[0], {
    id: Number.MAX_SAFE_INTEGER, name: `name-${Number.MAX_SAFE_INTEGER}`, role: "Viewer",
    isDisabled: false, tokenCount: Number.MAX_SAFE_INTEGER,
  });
});

test("failed or oversized data-source parents produce no partial health fan-out", async () => {
  const failed = emptyPlan(); failed.set("/api/datasources", rawResponse({ status: 403 }));
  const forbidden = await runPlan(failed);
  assert.deepEqual(forbidden.result.surfaces.datasourceHealth,
    surfaceFailure("unknown", "prerequisite_failed"));
  assert.equal(forbidden.trace.some((entry) => entry.path.includes("/health")), false);

  const tooMany = emptyPlan(); tooMany.set("/api/datasources", Array.from({ length: 17 }, (_, i) => datasource(`d${i}`)));
  const bounded = await runPlan(tooMany);
  assert.deepEqual(bounded.result.surfaces.datasourceHealth, surfaceFailure("unknown", "item_limit"));
  assert.equal(bounded.trace.some((entry) => entry.path.includes("/health")), false);
});

test("normalized output one-over limit replaces every surface without status or items", async () => {
  const long = "x".repeat(256);
  const plan = emptyPlan();
  plan.set("/api/datasources", Array.from({ length: 500 }, (_, i) => datasource(`ds${i}`, { name: long, type: long, access: long })));
  setSearchPages(plan, "dash-folder", Array.from({ length: 5 }, (_, page) =>
    Array.from({ length: page === 4 ? 99 : 100 }, (_, i) => searchItem("dash-folder", `f${page}-${i}`, { title: long }))));
  setSearchPages(plan, "dash-db", Array.from({ length: 5 }, (_, page) =>
    Array.from({ length: page === 4 ? 99 : 100 }, (_, i) => searchItem("dash-db", `d${page}-${i}`, { title: long }))));
  plan.set("/api/ruler/grafana/api/v1/rules", { namespace: [{ rules: Array.from({ length: 500 }, (_, i) => ({
    grafana_alert: { uid: `r${i}`, title: long }, labels: {}, annotations: {},
  })) }] });
  plan.set("/api/v1/provisioning/contact-points", Array.from({ length: 500 }, (_, i) =>
    ({ uid: `c${i}`, name: long, type: long, settings: {} })));
  setServicePages(plan, Array.from({ length: 5 }, (_, page) => ({
    serviceAccounts: Array.from({ length: 100 }, (_, i) => serviceAccount(page * 100 + i + 1,
      { name: long, role: long })), page: page + 1, perPage: 100, totalCount: 500,
  })));
  const { result } = await runPlan(plan);
  for (const surface of Object.values(result.surfaces)) {
    assert.deepEqual(surface, surfaceFailure("unknown", "output_byte_limit"));
  }
});
