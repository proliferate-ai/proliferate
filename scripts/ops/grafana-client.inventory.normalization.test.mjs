import assert from "node:assert/strict";
import test from "node:test";

import {
  INVENTORY_TARGET,
  completePlan,
  controlledRuntime,
  datasource,
  emptyPlan,
  isDatasourceHealthRequest,
  policyChain,
  rawResponse,
  runControlledBody,
  runPlan,
  searchItem,
  serviceAccount,
  setSearchPages,
  setServicePages,
  surfaceFailure,
  twoPageCompletePlan,
} from "./grafana-client.inventory.fixtures.mjs";

const PRECEDENCE_CONTRACT = Object.freeze({
  envelope: [1, "malformed", "invalid_shape"], apiState: [2, "unavailable", "api_database_not_ok"],
  pageLimit: [3, "unknown", "page_limit"], itemLimit: [4, "unknown", "item_limit"],
  depthLimit: [5, "unknown", "depth_limit"], keyLimit: [6, "unknown", "key_limit"],
  shape: [7, "malformed", "invalid_shape"], stringLimit: [8, "malformed", "string_limit"],
});

test("two-page complete projection is exact, canonically ordered, and privacy-negative", async () => {
  const { result, trace } = await runPlan(twoPageCompletePlan());
  assert.deepEqual(result.target, INVENTORY_TARGET);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, "grafana_metadata_inventory");
  assert.equal(result.queriedAt, "2026-08-19T00:00:00.000Z");
  assert.deepEqual(result.freshness, { state: "unknown", sourceTimestamp: null, expectedWithinMs: null,
    reason: "no_authoritative_configuration_freshness_contract" });
  assert.deepEqual(result.appliedLimits, {
    requestTimeoutMs: 5_000,
    inventoryTimeoutMs: 30_000,
    credentialBytes: 8_192,
    responseBytes: 524_288,
    totalResponseBytes: 4_194_304,
    pageSize: 100,
    pagesPerCollection: 5,
    itemsPerCollection: 500,
    requestCount: 37,
    datasourceHealthSources: 16,
    metadataStringBytes: 256,
    dynamicKeysPerMap: 64,
    policyRouteNodes: 500,
    policyDepth: 32,
    normalizedOutputBytes: 1_048_576,
  });
  assert.deepEqual(result.surfaces.api.items, [{ databaseOk: true, version: "10.4.0",
    versionMatchesExpected: true }]);
  assert.deepEqual(result.surfaces.datasources.items, [
    { uid: "z", name: "Zulu", type: "cloudwatch", access: "proxy", isDefault: false, readOnly: true },
    { uid: "é", name: "Accent", type: "prometheus", access: "proxy", isDefault: true, readOnly: false },
  ]);
  assert.equal(result.surfaces.folders.itemCount, 102);
  assert.deepEqual(result.surfaces.folders.items, [
    { uid: "f1", title: "First" }, { uid: "f2", title: "Second" },
    ...Array.from({ length: 100 }, (_, index) => ({
      uid: `folder-page-one-${String(index).padStart(3, "0")}`,
      title: `folder page one ${index}`,
    })),
  ]);
  assert.equal(result.surfaces.dashboards.itemCount, 102);
  assert.deepEqual(result.surfaces.dashboards.items, [
    { uid: "d1", title: "Nested", folderUid: "f1" },
    { uid: "d2", title: "Root", folderUid: null },
    ...Array.from({ length: 100 }, (_, index) => ({
      uid: `dashboard-page-one-${String(index).padStart(3, "0")}`,
      title: `dashboard page one ${index}`,
      folderUid: null,
    })),
  ]);
  assert.deepEqual(result.surfaces.alertRules.items[0], { uid: "r1", title: "Rule", folderUid: "f1",
    ruleGroup: "g", isPaused: false, noDataState: "NoData", execErrState: "Error",
    labelKeys: ["alpha", "severity"], annotationKeys: ["runbook"] });
  assert.deepEqual(result.surfaces.contactPoints.items, [{ uid: "c1", name: "Dark", type: "webhook",
    disableResolveMessage: false, settingKeys: ["alpha", "beta"] }]);
  assert.deepEqual(result.surfaces.notificationPolicy.items[0], {
    rootReceiver: "root", receiverNames: ["child", "root"], routeCount: 3, maxDepth: 1,
  });
  assert.deepEqual(result.surfaces.callerPermissions.items, [
    { action: "datasources:read", scopeCount: 2 },
    { action: "serviceaccounts:read", scopeCount: 1 },
  ]);
  assert.equal(result.surfaces.serviceAccounts.itemCount, 102);
  assert.deepEqual(result.surfaces.serviceAccounts.items, [
    { id: 1, name: "A", role: "Viewer", isDisabled: true, tokenCount: 1 },
    { id: 2, name: "B", role: "Viewer", isDisabled: false, tokenCount: 0 },
    ...Array.from({ length: 100 }, (_, index) => ({
      id: index + 3,
      name: `Page one ${99 - index}`,
      role: "Viewer",
      isDisabled: false,
      tokenCount: 99 - index,
    })),
  ]);
  assert.deepEqual(result.surfaces.datasourceHealth.items, [
    { uid: "z", state: "ok" },
    { uid: "é", state: "unavailable", reason: "datasource_health_failed", httpStatus: 200 },
  ]);
  for (const collection of ["dash-folder", "dash-db"]) {
    assert.ok(trace.some(({ path }) => path === `/api/search?type=${collection}&limit=100&page=2`));
    assert.equal(trace.some(({ path }) => path === `/api/search?type=${collection}&limit=100&page=3`), false);
  }
  assert.ok(trace.some(({ path }) => path === "/api/serviceaccounts/search?perpage=100&page=2"));
  assert.equal(trace.some(({ path }) => path === "/api/serviceaccounts/search?perpage=100&page=3"), false);
  const serialized = JSON.stringify({ result, trace });
  for (const forbidden of ["forbidden-datasource-id", "forbidden-datasource-org",
    "forbidden-datasource-user", "forbidden-datasource-database", "forbidden-datasource-basic-auth",
    "forbidden-basic-auth-user", "forbidden-datasource-password", "forbidden-url",
    "forbidden-json-data", "forbidden-token", "forbidden-secure-field", "forbidden-folder-url",
    "forbidden-query", "forbidden-dashboard-tags", "forbidden-dashboard-star",
    "forbidden-dashboard-body", "forbidden-dashboard-variable", "forbidden-dashboard-query",
    "forbidden-value", "forbidden-label-alpha-value", "forbidden-annotation-value",
    "forbidden-alert-condition", "forbidden-alert-expression", "forbidden-setting",
    "forbidden-secret", "forbidden-password", "forbidden-matcher", "forbidden-policy-group-wait",
    "forbidden-policy-group-interval", "forbidden-policy-repeat-interval",
    "forbidden-policy-mute-time", "forbidden-policy-active-time", "forbidden-scope",
    "forbidden-login", "forbidden-service-org", "forbidden-service-team", "forbidden-service-access",
    "forbidden-plugin-message", "forbidden-health-prose",
    "forbidden-folder-page-one", "forbidden-dashboard-query-page-one",
    "forbidden-service-account-page-one", "forbidden-service-account-avatar"] ) {
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
  const fullPages = Array.from({ length: 5 }, (_, page) =>
    Array.from({ length: 100 }, (_, index) => searchItem("dash-db", `d${page}-${index}`)));
  fullPages[4][0].uid = "d0-0";
  setSearchPages(capped, "dash-db", fullPages);
  const limited = await runPlan(capped);
  assert.deepEqual(limited.result.surfaces.dashboards, surfaceFailure("unknown", "page_limit", 200));
  assert.equal(limited.trace.some((entry) => entry.path.endsWith("page=6")), false);

  const oversized = emptyPlan();
  oversized.set("/api/search?type=dash-folder&limit=100&page=1",
    Array.from({ length: 101 }, (_, index) => searchItem("dash-folder", `f${index}`)));
  assert.deepEqual((await runPlan(oversized)).result.surfaces.folders,
    surfaceFailure("malformed", "invalid_shape", 200));
});

test("service-account transition completes on equality and never invents page six", async (t) => {
  const cases = [
    { name: "zero total", pages: [{ serviceAccounts: [], page: 1, perPage: 100, totalCount: 0 }],
      state: "empty", requests: 1 },
    { name: "short equality", pages: [{ serviceAccounts: [serviceAccount(1), serviceAccount(2)],
      page: 1, perPage: 100, totalCount: 2 }], state: "ok", requests: 1 },
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
    { name: "empty below total", pages: [{ serviceAccounts: [], page: 1, perPage: 100, totalCount: 1 }],
      reason: "invalid_shape", requests: 1 },
    { name: "more than one page", pages: [{ serviceAccounts: Array.from({ length: 101 }, (_, i) => serviceAccount(i + 1)),
      page: 1, perPage: 100, totalCount: 101 }], reason: "invalid_shape", requests: 1 },
    { name: "unsafe total", pages: [{ serviceAccounts: [], page: 1, perPage: 100,
      totalCount: Number.MAX_SAFE_INTEGER + 1 }], reason: "invalid_shape", requests: 1 },
    { name: "unstable total", pages: [
      { serviceAccounts: Array.from({ length: 100 }, (_, i) => serviceAccount(i + 1)),
        page: 1, perPage: 100, totalCount: 101 },
      { serviceAccounts: [serviceAccount(101)], page: 2, perPage: 100, totalCount: 102 },
    ], reason: "invalid_shape", requests: 2 },
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
  const incompleteRun = await runPlan(incomplete);
  assert.deepEqual(incompleteRun.result.surfaces.serviceAccounts,
    surfaceFailure("malformed", "invalid_shape", 200));
  assert.equal(incompleteRun.trace.filter((entry) => entry.path.startsWith("/api/serviceaccounts/search")).length, 5);

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
    { name: "row4 item before duplicate/string", selectedRule: "itemLimit", expectedRow: 4, lowerRow: 7,
      path: "/api/datasources", expiresAt: 11,
      surface: "datasources", state: "unknown", reason: "item_limit",
      mutate(plan) { plan.set("/api/datasources", Array.from({ length: 501 }, (_, i) => datasource(i < 2 ? "dup" : `d${i}`,
        { name: "x".repeat(257) }))); } },
    { name: "row3 final search page before duplicate", selectedRule: "pageLimit", expectedRow: 3, lowerRow: 7,
      path: "/api/search?type=dash-db&limit=100&page=5", expiresAt: 10,
      surface: "dashboards", state: "unknown", reason: "page_limit",
      mutate(plan) { const pages = Array.from({ length: 5 }, (_, page) => Array.from({ length: 100 }, (_, i) =>
        searchItem("dash-db", `d${page}-${i}`))); pages[4][0].uid = "d0-0"; setSearchPages(plan, "dash-db", pages); } },
    { name: "row1 service echo before item bound", selectedRule: "envelope", expectedRow: 1, lowerRow: 4,
      path: "/api/serviceaccounts/search?perpage=100&page=1", expiresAt: 8, surface: "serviceAccounts",
      state: "malformed", reason: "invalid_shape", mutate(plan) { setServicePages(plan,
        [{ serviceAccounts: [], page: 2, perPage: 100, totalCount: 501 }]); } },
    { name: "row4 service item bound before bad item", selectedRule: "itemLimit", expectedRow: 4, lowerRow: 7,
      path: "/api/serviceaccounts/search?perpage=100&page=1", expiresAt: 11, surface: "serviceAccounts",
      state: "unknown", reason: "item_limit", mutate(plan) { setServicePages(plan,
        [{ serviceAccounts: [serviceAccount(-1)], page: 1, perPage: 100, totalCount: 501 }]); } },
    { name: "row4 policy count before depth and shape", selectedRule: "itemLimit", expectedRow: 4, lowerRow: 5,
      path: "/api/v1/provisioning/policies", expiresAt: 512, surface: "notificationPolicy",
      state: "unknown", reason: "item_limit", mutate(plan) { const deep = policyChain(33, { receiver: 3 });
        plan.set("/api/v1/provisioning/policies", { receiver: "root", routes: [deep,
          ...Array.from({ length: 466 }, (_, i) => ({ receiver: `flat${i}` }))] }); } },
    { name: "row5 policy depth before malformed receiver", selectedRule: "depthLimit", expectedRow: 5, lowerRow: 7,
      path: "/api/v1/provisioning/policies", expiresAt: 80, surface: "notificationPolicy",
      state: "unknown", reason: "depth_limit", mutate(plan) {
        plan.set("/api/v1/provisioning/policies", policyChain(33, { receiver: 3 })); } },
    { name: "row6 key before invalid key", selectedRule: "keyLimit", expectedRow: 6, lowerRow: 7,
      path: "/api/v1/provisioning/contact-points", expiresAt: 14,
      surface: "contactPoints", state: "unknown", reason: "key_limit",
      mutate(plan) { const settings = Object.fromEntries(Array.from({ length: 63 }, (_, i) => [`k${i}`, i]));
        settings["k".repeat(257)] = 1; settings["\ud800"] = 1; plan.set("/api/v1/provisioning/contact-points",
          [{ uid: "c", name: "n", type: "x", settings }]); } },
    { name: "row7 duplicate before string", selectedRule: "shape", expectedRow: 7, lowerRow: 8,
      path: "/api/datasources", expiresAt: 16,
      surface: "datasources", state: "malformed", reason: "invalid_shape",
      mutate(plan) { plan.set("/api/datasources", [datasource("dup"), datasource("dup", { name: "x".repeat(257) })]); } },
    ...["labels", "annotations"].map((field) => ({
      name: `row7 explicit null ${field} before oversized title`,
      selectedRule: "shape", expectedRow: 7, lowerRow: 8,
      path: "/api/ruler/grafana/api/v1/rules", expiresAt: 17, surface: "alertRules",
      state: "malformed", reason: "invalid_shape",
      mutate(plan) {
        plan.set("/api/ruler/grafana/api/v1/rules", { n: [{ rules: [{
          grafana_alert: { uid: "rule", title: "x".repeat(257) },
          [field]: null,
        }] }] });
      },
    })),
    { name: "row2 database before bad version", selectedRule: "apiState", expectedRow: 2, lowerRow: 7,
      path: "/api/health", expiresAt: 9,
      surface: "api", state: "unavailable", reason: "api_database_not_ok",
      mutate(plan) { plan.set("/api/health", { database: "bad", version: 3 }); } },
    { name: "row7 health shape before unrelated string", selectedRule: "shape", expectedRow: 7, lowerRow: 8,
      path: "/api/datasources/uid/ds/health", observations: 14,
      state: "malformed", reason: "invalid_shape",
      expected: { uid: "ds", state: "malformed", reason: "invalid_shape", httpStatus: 200 },
      select(result) { return result.surfaces.datasourceHealth.items[0]; }, mutate(plan) {
        plan.set("/api/datasources", [datasource("ds")]);
        plan.set("/api/datasources/uid/ds/health", { message: "x".repeat(257) }); } },
    { name: "row8 health string before non-OK", selectedRule: "stringLimit", expectedRow: 8, lowerRow: 9,
      path: "/api/datasources/uid/ds/health", observations: 15,
      state: "malformed", reason: "string_limit",
      expected: { uid: "ds", state: "malformed", reason: "string_limit", httpStatus: 200 },
      select(result) { return result.surfaces.datasourceHealth.items[0]; }, mutate(plan) {
        plan.set("/api/datasources", [datasource("ds")]);
        plan.set("/api/datasources/uid/ds/health", { status: "x".repeat(257) }); } },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      assert.deepEqual([fixture.expectedRow, fixture.state, fixture.reason],
        PRECEDENCE_CONTRACT[fixture.selectedRule]);
      assert.ok(fixture.lowerRow > fixture.expectedRow, `${fixture.name}: lower-row collision`);
      const plan = emptyPlan(); fixture.mutate(plan);
      if (fixture.surface === "serviceAccounts") plan.set("/api/datasources", [datasource("deadline-parent")]);
      const expectedObservations = fixture.observations ?? fixture.expiresAt;
      const run = expectedObservations
        ? await runControlledBody(fixture.path, plan.get(fixture.path), fixture.expiresAt ?? Infinity, plan)
        : await runPlan(plan);
      if (expectedObservations) assert.equal(run.observations, expectedObservations);
      const { result } = run;
      const actual = fixture.select ? fixture.select(result) : result.surfaces[fixture.surface];
      const expected = fixture.expected ?? surfaceFailure(fixture.state, fixture.reason, 200);
      assert.deepEqual(actual, expected);
      assert.equal(Object.hasOwn(actual, "items"), false);
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

  const exactDepthPlan = emptyPlan();
  exactDepthPlan.set("/api/v1/provisioning/policies", policyChain(32));
  assert.equal((await runPlan(exactDepthPlan)).result.surfaces.notificationPolicy.items[0].maxDepth, 32);
});

test("a selected policy shape failure is not replaced by a later-node deadline", async () => {
  const runtime = controlledRuntime();
  let remaining = null;
  runtime.dependencies.monotonicNow = () => {
    if (remaining === null) return 0;
    if (remaining === 0) return 30_000;
    remaining -= 1;
    return 0;
  };
  const plan = emptyPlan();
  plan.set("/api/v1/provisioning/policies", rawResponse({ body: {
    receiver: 3,
    routes: [{ receiver: "later" }],
  }, onRead: (index) => { if (index === 1) remaining = 16; } }));
  const { result } = await runPlan(plan, runtime);
  assert.deepEqual(result.surfaces.notificationPolicy,
    surfaceFailure("malformed", "invalid_shape", 200));
});

test("non-deadline defects propagate from direct, paged, service, and health normalizers", async (t) => {
  for (const [name, configure] of [
    ["direct", (plan, response) => plan.set("/api/health", response)],
    ["paged", (plan, response) => plan.set("/api/search?type=dash-folder&limit=100&page=1", response)],
    ["service", (plan, response) => plan.set("/api/serviceaccounts/search?perpage=100&page=1", response)],
    ["health", (plan, response) => {
      plan.set("/api/datasources", [datasource("ds")]);
      plan.set("/api/datasources/uid/ds/health", response);
    }],
  ]) {
    await t.test(name, async () => {
      const defect = new Error(`${name}-normalizer-programmer-defect`);
      const runtime = controlledRuntime();
      let remaining = null;
      runtime.dependencies.monotonicNow = () => {
        if (remaining === null) return 0;
        if (remaining === 0) throw defect;
        remaining -= 1;
        return 0;
      };
      const body = name === "service"
        ? { serviceAccounts: [], page: 1, perPage: 100, totalCount: 0 }
        : name === "health" ? { status: "OK" } : name === "paged" ? [] : { database: "ok" };
      // Pass post-read, empty-body, decode, and JSON; throw at parsed row 1.
      const response = rawResponse({ body,
        onRead: (index) => { if (index === 1) remaining = 6; } });
      const plan = emptyPlan();
      configure(plan, response);
      await assert.rejects(runPlan(plan, runtime), (error) => error === defect);
    });
  }
});

test("Unicode, path, number, duplicate, and string limits fail closed before fan-out", async (t) => {
  const cases = [
    ["lone high UID", datasource("\ud800", { name: "valid" }), "invalid_shape"],
    ["lone low UID", JSON.parse(JSON.stringify(datasource("\udfff", { name: "valid" }))), "invalid_shape"],
    ["lone low name", datasource("ok", { name: "\udfff" }), "invalid_shape"],
    ["unsafe path", datasource("../bad"), "invalid_shape"],
    ["C1 U+0080 UID", JSON.parse(JSON.stringify(datasource("c1-\u0080"))), "invalid_shape"],
    ["C1 U+009F UID", JSON.parse(JSON.stringify(datasource("c1-\u009f"))), "invalid_shape"],
    ["one-over string", datasource("ok", { name: "x".repeat(257) }), "string_limit"],
  ];
  for (const [name, item, reason] of cases) {
    await t.test(name, async () => {
      const plan = emptyPlan(); plan.set("/api/datasources", [item]);
      const { result, trace } = await runPlan(plan);
      assert.deepEqual(result.surfaces.datasources, surfaceFailure("malformed", reason, 200));
      assert.equal(trace.some(isDatasourceHealthRequest), false);
    });
  }
  for (const account of [serviceAccount(Number.MAX_SAFE_INTEGER + 1),
    serviceAccount(1, { tokens: Number.MAX_SAFE_INTEGER + 1 }), serviceAccount(1, { tokens: -1 })]) {
    const plan = emptyPlan(); setServicePages(plan, [{ serviceAccounts: [account], page: 1, perPage: 100, totalCount: 1 }]);
    assert.deepEqual((await runPlan(plan)).result.surfaces.serviceAccounts,
      surfaceFailure("malformed", "invalid_shape", 200));
  }
});

test("Ruler row 4 and row 6 are atomic, order-independent, and precede invalid keys", async (t) => {
  const invalidNamespace = "\ud800";
  // Six post-body observations plus one per parsed row place the next allowed
  // observation at 11 after row 4 and 13 after row 6.
  const cases = [
    {
      name: "row 4 item aggregate",
      entries: [
        ["bounded", [{ rules: Array.from({ length: 501 }, () => ({})) }]],
        [invalidNamespace, []],
      ],
      expiresAt: 11,
      expected: surfaceFailure("unknown", "item_limit", 200),
    },
    {
      name: "row 6 key aggregate",
      entries: [
        ["bounded", [{ rules: [{
          grafana_alert: { uid: "rule", title: "Rule" },
          labels: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`k${index}`, index])),
        }] }]],
        [invalidNamespace, []],
      ],
      expiresAt: 13,
      expected: surfaceFailure("unknown", "key_limit", 200),
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const run = (entries) => runControlledBody("/api/ruler/grafana/api/v1/rules",
        Object.fromEntries(entries), fixture.expiresAt);
      const forward = await run(fixture.entries);
      const reverse = await run([...fixture.entries].reverse());
      assert.deepEqual(forward.result.surfaces.alertRules, fixture.expected);
      assert.deepEqual(reverse.result.surfaces.alertRules, fixture.expected);
      assert.deepEqual(forward.trace, reverse.trace);
      assert.equal(forward.observations, fixture.expiresAt);
      assert.equal(reverse.observations, fixture.expiresAt);
    });
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

test("non-ASCII permission actions use canonical UTF-8 traversal under either insertion order", async () => {
  const bmpLong = "\uffff".repeat(86);
  const astral = "\u{10000}";
  assert.deepEqual([bmpLong, astral].sort(), [astral, bmpLong]);
  const entries = [[astral, []], [bmpLong, []]];
  // Canonical UTF-8 visits the oversized BMP action first at observation 17;
  // observation 18 is reached only after its row-8 string failure is selected.
  const run = (ordered) => runControlledBody("/api/access-control/user/permissions",
    Object.fromEntries(ordered), 18);
  const forward = await run(entries);
  const reverse = await run([...entries].reverse());
  const expected = surfaceFailure("malformed", "string_limit", 200);
  assert.deepEqual(forward.result.surfaces.callerPermissions, expected);
  assert.deepEqual(reverse.result.surfaces.callerPermissions, expected);
  assert.equal(forward.observations, 18);
  assert.equal(reverse.observations, 18);
  assert.deepEqual(forward.trace, reverse.trace);
  assert.equal(JSON.stringify(forward.result), JSON.stringify(reverse.result));
  assert.equal(Buffer.byteLength(JSON.stringify(forward.result), "utf8"),
    Buffer.byteLength(JSON.stringify(reverse.result), "utf8"));
});

test("unsigned UTF-8 ordering is used for object IDs and derived key/name sets", async () => {
  const bmp = "\uffff";
  const astral = "\u{10000}";
  assert.deepEqual([bmp, astral].sort(), [astral, bmp]);
  const plan = emptyPlan();
  plan.set("/api/search?type=dash-folder&limit=100&page=1", [
    searchItem("dash-folder", astral), searchItem("dash-folder", bmp),
  ]);
  plan.set("/api/v1/provisioning/contact-points", [{ uid: "c", name: "n", type: "x",
    settings: { [astral]: 1, [bmp]: 2 } }]);
  plan.set("/api/v1/provisioning/policies", { receiver: astral, routes: [{ receiver: bmp }] });
  const { result } = await runPlan(plan);
  assert.deepEqual(result.surfaces.folders.items.map((item) => item.uid), [bmp, astral]);
  assert.deepEqual(result.surfaces.contactPoints.items[0].settingKeys, [bmp, astral]);
  assert.deepEqual(result.surfaces.notificationPolicy.items[0].receiverNames, [bmp, astral]);
});

test("all object collections reject repeated identities instead of de-duplicating", async (t) => {
  const fixtures = [
    ["datasources", "/api/datasources", [datasource("dup"), datasource("dup")]],
    ["folders", "/api/search?type=dash-folder&limit=100&page=1", [
      searchItem("dash-folder", "dup"), searchItem("dash-folder", "dup"),
    ]],
    ["dashboards", "/api/search?type=dash-db&limit=100&page=1", [
      searchItem("dash-db", "dup"), searchItem("dash-db", "dup"),
    ]],
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
  const surrogateKey = emptyPlan(); surrogateKey.set("/api/v1/provisioning/contact-points",
    [{ uid: "c", name: "n", type: "x", settings: { ["\ud800"]: "ignored" } }]);
  assert.deepEqual((await runPlan(surrogateKey)).result.surfaces.contactPoints,
    surfaceFailure("malformed", "invalid_shape", 200));
  const exact = emptyPlan(); exact.set("/api/v1/provisioning/contact-points",
    [{ uid: "c", name: "x".repeat(256), type: "x",
      settings: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i}`, i])) }]);
  assert.equal((await runPlan(exact)).result.surfaces.contactPoints.state, "ok");
  const missing = completePlan(); missing.set("/api/datasources/uid/z/health",
    { message: "x".repeat(257) });
  assert.deepEqual((await runPlan(missing)).result.surfaces.datasourceHealth.items[0],
    { uid: "z", state: "malformed", reason: "invalid_shape", httpStatus: 200 });
  const wrongType = completePlan(); wrongType.set("/api/datasources/uid/z/health",
    { status: { private: "forbidden-wrong-health-status" } });
  const wrongTypeResult = (await runPlan(wrongType)).result;
  assert.deepEqual(wrongTypeResult.surfaces.datasourceHealth.items[0],
    { uid: "z", state: "malformed", reason: "invalid_shape", httpStatus: 200 });
  assert.equal(JSON.stringify(wrongTypeResult).includes("forbidden-wrong-health-status"), false);
  const oversized = completePlan(); oversized.set("/api/datasources/uid/z/health",
    { status: "x".repeat(257), message: "ignored" });
  assert.deepEqual((await runPlan(oversized)).result.surfaces.datasourceHealth.items[0],
    { uid: "z", state: "malformed", reason: "string_limit", httpStatus: 200 });
});

test("alert label and annotation maps default only when absent", async (t) => {
  const absent = emptyPlan();
  absent.set("/api/ruler/grafana/api/v1/rules", { n: [{ rules: [
    { grafana_alert: { uid: "rule", title: "Rule" } },
  ] }] });
  assert.deepEqual((await runPlan(absent)).result.surfaces.alertRules.items[0], {
    uid: "rule", title: "Rule", folderUid: null, ruleGroup: null, isPaused: false,
    noDataState: null, execErrState: null, labelKeys: [], annotationKeys: [],
  });
  for (const field of ["labels", "annotations"]) {
    await t.test(`explicit null ${field}`, async () => {
      const plan = emptyPlan();
      plan.set("/api/ruler/grafana/api/v1/rules", { n: [{ rules: [
        { grafana_alert: { uid: "rule", title: "Rule" }, [field]: null },
      ] }] });
      assert.deepEqual((await runPlan(plan)).result.surfaces.alertRules,
        surfaceFailure("malformed", "invalid_shape", 200));
    });
  }
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
  assert.equal(forbidden.trace.some(isDatasourceHealthRequest), false);

  const tooMany = emptyPlan(); tooMany.set("/api/datasources", Array.from({ length: 17 }, (_, i) => datasource(`d${i}`)));
  const bounded = await runPlan(tooMany);
  assert.deepEqual(bounded.result.surfaces.datasourceHealth, surfaceFailure("unknown", "item_limit"));
  assert.equal(bounded.trace.some(isDatasourceHealthRequest), false);
});

const OUTPUT_LIMIT = 1_048_576;

function outputBoundaryPlan(contactCount, tuningBytes = 0) {
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
  const widths = [1, 1, 1, 1];
  for (let index = 0; index < widths.length; index += 1) {
    const addition = Math.min(tuningBytes, 255);
    widths[index] += addition;
    tuningBytes -= addition;
  }
  assert.equal(tuningBytes, 0);
  const contacts = Array.from({ length: contactCount }, (_, index) => ({
    uid: `c${index}`,
    name: "n",
    type: "x",
    settings: { [`${index}-`.padEnd(256, "k")]: "forbidden-output-bulk-value" },
  }));
  contacts.push({
    uid: "t".repeat(widths[0]),
    name: "n".repeat(widths[1]),
    type: "x".repeat(widths[2]),
    settings: { ["s".repeat(widths[3])]: "forbidden-output-tuner-value" },
  });
  plan.set("/api/v1/provisioning/contact-points", contacts);
  return plan;
}

function serializedBytes(result) {
  return Buffer.byteLength(JSON.stringify(result), "utf8");
}

function assertOutputLimited(result) {
  for (const surface of Object.values(result.surfaces)) {
    assert.deepEqual(surface, surfaceFailure("unknown", "output_byte_limit"));
  }
}

test("normalized output accepts exactly 1,048,576 bytes and rejects exactly one byte more", async () => {
  assert.equal((await runPlan(outputBoundaryPlan(0))).result.surfaces.api.state, "ok");
  assertOutputLimited((await runPlan(outputBoundaryPlan(499))).result);
  let accepted = 0;
  let rejected = 499;
  while (rejected - accepted > 1) {
    const candidate = Math.floor((accepted + rejected) / 2);
    const { result } = await runPlan(outputBoundaryPlan(candidate));
    if (result.surfaces.api.reason === "output_byte_limit") rejected = candidate;
    else accepted = candidate;
  }
  const baseline = await runPlan(outputBoundaryPlan(accepted));
  const tuningBytes = OUTPUT_LIMIT - serializedBytes(baseline.result);
  assert.ok(tuningBytes >= 0 && tuningBytes < 1_020);
  const exactPlan = outputBoundaryPlan(accepted, tuningBytes);
  const exact = await runPlan(exactPlan);
  assert.equal(serializedBytes(exact.result), OUTPUT_LIMIT);

  const oneOverPlan = outputBoundaryPlan(accepted, tuningBytes + 1);
  const projectedWidth = (plan) => {
    const item = plan.get("/api/v1/provisioning/contact-points").at(-1);
    return item.uid.length + item.name.length + item.type.length + Object.keys(item.settings)[0].length;
  };
  const oneOverDelta = projectedWidth(oneOverPlan) - projectedWidth(exactPlan);
  assert.equal(oneOverDelta, 1);
  assert.equal(serializedBytes(exact.result) + oneOverDelta, OUTPUT_LIMIT + 1);
  assertOutputLimited((await runPlan(oneOverPlan)).result);

  const runtime = controlledRuntime();
  const nativeStringify = JSON.stringify;
  let advancedDuringSerialization = false;
  let collision;
  try {
    JSON.stringify = function (value, ...args) {
      if (value?.kind === "grafana_metadata_inventory") {
        advancedDuringSerialization = true;
        runtime.set(30_000);
      }
      return nativeStringify.call(this, value, ...args);
    };
    collision = await runPlan(oneOverPlan, runtime);
  } finally {
    JSON.stringify = nativeStringify;
  }
  assert.equal(advancedDuringSerialization, true);
  assertOutputLimited(collision.result);
});
