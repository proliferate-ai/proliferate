import assert from "node:assert/strict";
import test from "node:test";

import { readMetadataInventoryInternal } from "./grafana-metadata-inventory.mjs";
import {
  INVENTORY_TARGET,
  controlledRuntime,
  emptyPlan,
  fixtureFetch,
  internalPrepare,
  rawResponse,
  surfaceFailure,
} from "./grafana-client.inventory.fixtures.mjs";

async function runPlan(plan, { runtime = controlledRuntime(), trace = [] } = {}) {
  const fetchImpl = fixtureFetch(plan, { trace });
  const result = await readMetadataInventoryInternal({
    target: INVENTORY_TARGET,
    prepareAuthorizedGet: internalPrepare(fetchImpl),
    productionClockAndTimers: runtime.dependencies,
  });
  return { result, runtime, trace };
}

async function apiResponse(response, options) {
  const plan = emptyPlan();
  plan.set("/api/health", response);
  return runPlan(plan, options);
}

function paddedJson(payload, size) {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  assert.ok(encoded.length <= size);
  const bytes = new Uint8Array(size);
  bytes.fill(0x20);
  bytes.set(encoded);
  return bytes;
}

function fillAggregateBoundary(plan) {
  for (const [path, payload] of [
    ["/api/health", { database: "ok" }],
    ["/api/datasources", []],
    ["/api/search?type=dash-folder&limit=100&page=1", []],
    ["/api/search?type=dash-db&limit=100&page=1", []],
    ["/api/ruler/grafana/api/v1/rules", {}],
    ["/api/v1/provisioning/contact-points", []],
    ["/api/v1/provisioning/policies", { receiver: "root" }],
    ["/api/access-control/user/permissions", {}],
  ]) plan.set(path, rawResponse({ bytes: paddedJson(payload, 524_288) }));
}

function armDeadlineAfter(runtime, passedCheckpoints) {
  let remaining = null;
  runtime.dependencies.monotonicNow = () => {
    if (remaining === null) return 0;
    if (remaining === 0) return 30_000;
    remaining -= 1;
    return 0;
  };
  return () => { remaining = passedCheckpoints; };
}

test("response-origin mismatch wins before deadline and status classification", async () => {
  const runtime = controlledRuntime();
  let reads = 0;
  const response = () => {
    runtime.set(30_000);
    return rawResponse({ status: 301, url: "https://hostile.invalid/api/health",
      body: "hostile-location-and-body", onRead: () => { reads += 1; } });
  };
  const { result, trace } = await apiResponse(response, { runtime });
  assert.deepEqual(result.surfaces.api, surfaceFailure("target_mismatch", "origin_mismatch", 301));
  assert.equal(reads, 0);
  assert.equal(trace.length, 1);
  assert.equal(JSON.stringify(result).includes("hostile"), false);
});

test("an absent response URL is target mismatch with the received status", async () => {
  const response = rawResponse({ status: 200, body: { database: "ok" }, url: "" });
  const { result } = await apiResponse(response);
  assert.deepEqual(result.surfaces.api, surfaceFailure("target_mismatch", "origin_mismatch", 200));
});

test("valid-origin expired post-fetch checkpoint beats redirect, auth, server, and body states", async (t) => {
  for (const status of [301, 401, 500, 200]) {
    await t.test(String(status), async () => {
      const runtime = controlledRuntime();
      let reads = 0;
      const { result, trace } = await apiResponse(() => {
        runtime.set(30_000);
        return rawResponse({ status, bytes: new Uint8Array([0xff]), onRead: () => { reads += 1; } });
      }, { runtime });
      assert.deepEqual(result.surfaces.api, surfaceFailure("unavailable", "timeout", status));
      assert.equal(reads, 0);
      assert.equal(trace.length, 1);
      assert.deepEqual(result.surfaces.datasources, surfaceFailure("unavailable", "timeout"));
    });
  }
});

test("HTTP status table is total, exact, body-free, and non-retrying", async (t) => {
  const cases = [
    [301, "redirect_refused", "redirect_status"], [302, "redirect_refused", "redirect_status"],
    [307, "redirect_refused", "redirect_status"], [308, "redirect_refused", "redirect_status"],
    [401, "unauthorized", "http_401"], [403, "forbidden", "http_403"],
    [404, "unsupported", "endpoint_not_found"], [405, "unsupported", "method_not_allowed"],
    [501, "unsupported", "not_implemented"], [408, "unavailable", "timeout"],
    [429, "rate_limited", "http_429"], [500, "unavailable", "http_5xx"],
    [599, "unavailable", "http_5xx"], [204, "malformed", "empty_body"],
    [201, "unknown", "unclassified_http_status"], [418, "unknown", "unclassified_http_status"],
  ];
  for (const [status, state, reason] of cases) {
    await t.test(String(status), async () => {
      let reads = 0;
      const { result, trace } = await apiResponse(rawResponse({ status, body: "provider-prose-sentinel",
        onRead: () => { reads += 1; } }));
      assert.deepEqual(result.surfaces.api, surfaceFailure(state, reason, status));
      assert.equal(reads, 0);
      assert.equal(trace.filter((entry) => entry.path === "/api/health").length, 1);
      assert.equal(JSON.stringify(result).includes("provider-prose-sentinel"), false);
    });
  }
});

test("direct, contact-point, and service-account endpoints share exact 404/405/501 mapping", async (t) => {
  for (const [surface, path] of [
    ["datasources", "/api/datasources"],
    ["contactPoints", "/api/v1/provisioning/contact-points"],
    ["serviceAccounts", "/api/serviceaccounts/search?perpage=100&page=1"],
  ]) {
    for (const [status, reason] of [[404, "endpoint_not_found"], [405, "method_not_allowed"], [501, "not_implemented"]]) {
      await t.test(`${surface}-${status}`, async () => {
        const plan = emptyPlan();
        plan.set(path, rawResponse({ status, body: "unread-error-prose" }));
        const { result, trace } = await runPlan(plan);
        assert.deepEqual(result.surfaces[surface], surfaceFailure("unsupported", reason, status));
        assert.equal(trace.filter((entry) => entry.path === path).length, 1);
      });
    }
  }
});

test("health-child endpoint statuses use plugin-specific closed reasons", async (t) => {
  for (const [status, state, reason] of [
    [404, "unknown", "object_disappeared"],
    [405, "unsupported", "plugin_health_unsupported"],
    [501, "unsupported", "plugin_health_unsupported"],
  ]) {
    await t.test(String(status), async () => {
      const plan = emptyPlan();
      plan.set("/api/datasources", [{ uid: "ds", name: "Data", type: "x", access: "proxy",
        isDefault: false, readOnly: true }]);
      plan.set("/api/datasources/uid/ds/health", rawResponse({ status, body: "unread-plugin-prose" }));
      const { result } = await runPlan(plan);
      assert.deepEqual(result.surfaces.datasourceHealth.items, [{ uid: "ds", state, reason, httpStatus: status }]);
    });
  }
});

test("content-length syntax, declared byte precedence, and cancellation are exact", async (t) => {
  for (const value of ["", "1,2", "-1", "+1", "1x", String(Number.MAX_SAFE_INTEGER + 1)]) {
    await t.test(value, async () => {
      let cancelled = 0;
      const { result } = await apiResponse(rawResponse({ contentLength: value,
        onCancel: () => { cancelled += 1; } }));
      assert.deepEqual(result.surfaces.api, surfaceFailure("malformed", "invalid_content_length", 200));
      assert.equal(cancelled, 1);
    });
  }
  const declared = await apiResponse(rawResponse({ contentLength: String(524_289),
    bytes: new TextEncoder().encode("{}") }));
  assert.deepEqual(declared.result.surfaces.api, surfaceFailure("unknown", "response_byte_limit", 200));
  const exactBytes = paddedJson({ database: "ok" }, 524_288);
  const exact = await apiResponse(rawResponse({ contentLength: String(exactBytes.length), bytes: exactBytes }));
  assert.equal(exact.result.surfaces.api.state, "ok");
  const cancelReject = await apiResponse(rawResponse({ status: 401,
    onCancel: () => Promise.reject(new Error("cancel-sentinel")) }));
  assert.deepEqual(cancelReject.result.surfaces.api, surfaceFailure("unauthorized", "http_401", 401));
});

test("streamed body table distinguishes empty, UTF-8, JSON, network, and byte failures", async () => {
  const empty = await apiResponse(rawResponse({ bytes: new Uint8Array() }));
  assert.deepEqual(empty.result.surfaces.api, surfaceFailure("malformed", "empty_body", 200));
  const whitespace = await apiResponse(rawResponse({ body: "  \n" }));
  assert.deepEqual(whitespace.result.surfaces.api, surfaceFailure("malformed", "invalid_json", 200));
  const utf8 = await apiResponse(rawResponse({ bytes: new Uint8Array([0xff]) }));
  assert.deepEqual(utf8.result.surfaces.api, surfaceFailure("malformed", "invalid_utf8", 200));
  const json = await apiResponse(rawResponse({ body: "{" }));
  assert.deepEqual(json.result.surfaces.api, surfaceFailure("malformed", "invalid_json", 200));
  const rejected = await apiResponse(rawResponse({ readError: { at: 0, error: new Error("body-prose") } }));
  assert.deepEqual(rejected.result.surfaces.api, surfaceFailure("unavailable", "network_unavailable", 200));
  const overflow = await apiResponse(rawResponse({ bytes: new Uint8Array(524_289) }));
  assert.deepEqual(overflow.result.surfaces.api, surfaceFailure("unknown", "response_byte_limit", 200));
  const exact = await apiResponse(rawResponse({ bytes: paddedJson({ database: "ok" }, 524_288) }));
  assert.equal(exact.result.surfaces.api.state, "ok");
});

test("fetch rejection before a response has no HTTP status or provider prose", async () => {
  const plan = emptyPlan();
  plan.set("/api/health", () => { throw new Error("fetch-provider-prose"); });
  const { result } = await runPlan(plan);
  assert.deepEqual(result.surfaces.api, surfaceFailure("unavailable", "network_unavailable"));
  assert.equal(JSON.stringify(result).includes("fetch-provider-prose"), false);
});

test("a synchronous response-seam defect is not fabricated into timeout", async () => {
  const defect = new Error("response-seam-programmer-defect");
  const response = rawResponse({ body: { database: "ok" } });
  response.headers.get = () => { throw defect; };
  await assert.rejects(apiResponse(response), (error) => error === defect);
});

test("deadline at the post-read checkpoint beats a returned over-limit invalid chunk", async () => {
  const runtime = controlledRuntime();
  const { result } = await apiResponse(rawResponse({ bytes: new Uint8Array(524_289),
    onRead: (index) => { if (index === 0) runtime.set(30_000); } }), { runtime });
  assert.deepEqual(result.surfaces.api, surfaceFailure("unavailable", "timeout", 200));
});

test("passed checkpoints make synchronous byte, decode, and JSON classifications atomic", async (t) => {
  for (const [name, response, passes, expected] of [
    ["byte", { bytes: new Uint8Array(524_289) }, 1, surfaceFailure("unknown", "response_byte_limit", 200)],
    ["decode", { bytes: new Uint8Array([0xff]) }, 5, surfaceFailure("malformed", "invalid_utf8", 200)],
    ["json", { body: "{" }, 6, surfaceFailure("malformed", "invalid_json", 200)],
  ]) {
    await t.test(name, async () => {
      const runtime = controlledRuntime();
      const arm = armDeadlineAfter(runtime, passes);
      const { result } = await apiResponse(rawResponse({ ...response,
        onRead: (index) => { if (index === 0) arm(); } }), { runtime });
      assert.deepEqual(result.surfaces.api, expected);
    });
  }
});

test("fetch and body rejection become timeout when their post-await checkpoint has passed", async () => {
  const fetchRuntime = controlledRuntime();
  const fetchPlan = emptyPlan();
  fetchPlan.set("/api/health", () => { fetchRuntime.set(30_000); throw new Error("late-fetch"); });
  assert.deepEqual((await runPlan(fetchPlan, { runtime: fetchRuntime })).result.surfaces.api,
    surfaceFailure("unavailable", "timeout"));

  const bodyRuntime = controlledRuntime();
  const body = rawResponse({ readError: { at: 0, error: new Error("late-body") },
    onRead: () => { bodyRuntime.set(30_000); } });
  assert.deepEqual((await apiResponse(body, { runtime: bodyRuntime })).result.surfaces.api,
    surfaceFailure("unavailable", "timeout", 200));
});

test("a request timeout is local while the whole deadline is global", async () => {
  const runtime = controlledRuntime();
  const plan = emptyPlan();
  plan.set("/api/health", () => {
    runtime.set(5_000);
    return rawResponse({ status: 401 });
  });
  const { result } = await runPlan(plan, { runtime });
  assert.deepEqual(result.surfaces.api, surfaceFailure("unavailable", "timeout", 401));
  assert.equal(result.surfaces.datasources.state, "empty");
});

test("aggregate exact boundary is accepted and one declared byte over stops globally", async () => {
  const plan = emptyPlan();
  fillAggregateBoundary(plan);
  plan.set("/api/serviceaccounts/search?perpage=100&page=1", rawResponse({ contentLength: "1",
    body: { serviceAccounts: [], page: 1, perPage: 100, totalCount: 0 } }));
  const { result, trace } = await runPlan(plan);
  assert.deepEqual(result.surfaces.serviceAccounts, surfaceFailure("unknown", "total_byte_limit", 200));
  assert.deepEqual(result.surfaces.datasourceHealth, surfaceFailure("unknown", "total_byte_limit"));
  assert.equal(trace.length, 9);
});

test("per-response wins simultaneous declared/streamed overflow; streamed aggregate overflow is global", async () => {
  const servicePath = "/api/serviceaccounts/search?perpage=100&page=1";
  for (const [name, response] of [
    ["declared", rawResponse({ contentLength: "524289", bytes: new Uint8Array([1]) })],
    ["streamed", rawResponse({ bytes: new Uint8Array(524_289) })],
  ]) {
    const plan = emptyPlan(); fillAggregateBoundary(plan); plan.set(servicePath, response);
    const { result } = await runPlan(plan);
    assert.deepEqual(result.surfaces.serviceAccounts,
      surfaceFailure("unknown", "response_byte_limit", 200), name);
    assert.equal(result.surfaces.datasourceHealth.state, "empty");
  }

  const aggregate = emptyPlan(); fillAggregateBoundary(aggregate);
  aggregate.set(servicePath, rawResponse({ body: { serviceAccounts: [], page: 1,
    perPage: 100, totalCount: 0 } }));
  const { result } = await runPlan(aggregate);
  assert.deepEqual(result.surfaces.serviceAccounts, surfaceFailure("unknown", "total_byte_limit", 200));
  assert.deepEqual(result.surfaces.datasourceHealth, surfaceFailure("unknown", "total_byte_limit"));
});

test("whole deadline at final serialization replaces every completed surface", async () => {
  const runtime = controlledRuntime();
  const plan = emptyPlan();
  let remaining = null;
  runtime.dependencies.monotonicNow = () => {
    if (remaining === null) return 0;
    if (remaining === 0) return 30_000;
    remaining -= 1;
    return 0;
  };
  const service = plan.get("/api/serviceaccounts/search?perpage=100&page=1");
  // Fourteen mandatory body/service checkpoints pass; the fifteenth is final-output serialization.
  plan.set("/api/serviceaccounts/search?perpage=100&page=1",
    rawResponse({ body: service, onRead: (index) => { if (index === 1) remaining = 14; } }));
  const { result } = await runPlan(plan, { runtime });
  for (const surface of Object.values(result.surfaces)) {
    assert.deepEqual(surface, surfaceFailure("unavailable", "timeout"));
  }
});
