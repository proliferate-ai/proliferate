import assert from "node:assert/strict";

import { TARGET, WORKSPACE_BASE_URL, createGrafanaClient } from "./grafana-client.mjs";

export const INVENTORY_TARGET = Object.freeze({
  awsAccount: TARGET.awsAccount,
  awsRegion: TARGET.awsRegion,
  grafanaWorkspaceId: TARGET.grafanaWorkspaceId,
  grafanaWorkspaceName: TARGET.grafanaWorkspaceName,
  expectedGrafanaVersion: TARGET.grafanaVersion,
});

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

export function rawResponse({
  status = 200,
  body = {},
  bytes,
  url = `${WORKSPACE_BASE_URL}/api/fixture`,
  contentLength,
  chunks,
  readError,
  onCancel,
  onRead,
} = {}) {
  const encoded = bytes ?? new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body));
  const parts = chunks ?? [encoded];
  let index = 0;
  const reader = {
    async read() {
      onRead?.(index);
      if (readError && index === readError.at) throw readError.error;
      if (index >= parts.length) return { done: true, value: undefined };
      return { done: false, value: parts[index++] };
    },
    async cancel() { return onCancel?.(); },
  };
  return {
    status,
    url,
    headers: { get: (name) => name.toLowerCase() === "content-length" ? (contentLength ?? null) : null },
    body: { getReader: () => reader, cancel: () => reader.cancel() },
  };
}

export function emptyPlan() {
  return new Map([
    ["/api/health", { database: "ok", version: "10.4.0" }],
    ["/api/datasources", []],
    ["/api/search?type=dash-folder&limit=100&page=1", []],
    ["/api/search?type=dash-db&limit=100&page=1", []],
    ["/api/ruler/grafana/api/v1/rules", {}],
    ["/api/v1/provisioning/contact-points", []],
    ["/api/v1/provisioning/policies", { receiver: "root" }],
    ["/api/access-control/user/permissions", {}],
    ["/api/serviceaccounts/search?perpage=100&page=1",
      { serviceAccounts: [], page: 1, perPage: 100, totalCount: 0 }],
  ]);
}

export function completePlan() {
  const plan = emptyPlan();
  plan.set("/api/datasources", [
    { uid: "z", name: "Zulu", type: "cloudwatch", access: "proxy", isDefault: false, readOnly: true,
      url: "forbidden-url", secureJsonData: { token: "forbidden-token" } },
    { uid: "é", name: "Accent", type: "prometheus", access: "proxy", isDefault: true, readOnly: false },
  ]);
  plan.set("/api/search?type=dash-folder&limit=100&page=1", [
    { uid: "f2", title: "Second", type: "dash-folder", url: "forbidden-folder-url" },
    { uid: "f1", title: "First", type: "dash-folder" },
  ]);
  plan.set("/api/search?type=dash-db&limit=100&page=1", [
    { uid: "d2", title: "Root", type: "dash-db", panels: ["forbidden-query"] },
    { uid: "d1", title: "Nested", type: "dash-db", folderUid: "f1" },
  ]);
  plan.set("/api/ruler/grafana/api/v1/rules", {
    folder: [{ rules: [{
      labels: { severity: "forbidden-value", alpha: "also-forbidden" },
      annotations: { runbook: "forbidden-annotation-value" },
      grafana_alert: { uid: "r1", title: "Rule", namespace_uid: "f1", rule_group: "g",
        is_paused: false, no_data_state: "NoData", exec_err_state: "Error", data: ["forbidden-model"] },
    }] }],
  });
  plan.set("/api/v1/provisioning/contact-points", [{ uid: "c1", name: "Dark", type: "webhook",
    disableResolveMessage: false, settings: { beta: "forbidden-setting", alpha: "forbidden-secret" },
    secureSettings: { password: "forbidden-password" } }]);
  plan.set("/api/v1/provisioning/policies", { receiver: "root", routes: [
    { receiver: "child", matchers: [["customer", "=", "forbidden-matcher"]] },
    { receiver: "root" },
  ] });
  plan.set("/api/access-control/user/permissions", {
    "serviceaccounts:read": ["forbidden-scope"],
    "datasources:read": ["one", "two"],
    "datasources:write": ["ignored"],
  });
  plan.set("/api/serviceaccounts/search?perpage=100&page=1", { serviceAccounts: [
    { id: 2, name: "B", role: "Viewer", isDisabled: false, tokens: 0, login: "forbidden-login" },
    { id: 1, name: "A", role: "Viewer", isDisabled: true, tokens: 1 },
  ], page: 1, perPage: 100, totalCount: 2 });
  plan.set("/api/datasources/uid/z/health", { status: "OK", message: "forbidden-plugin-message" });
  plan.set("/api/datasources/uid/%C3%A9/health", { status: "ERROR", message: "forbidden-health-prose" });
  return plan;
}

function routeValue(plan, key, call) {
  const value = plan.get(key);
  if (Array.isArray(value) && value.length > 0 &&
      value.every((entry) => entry?.fixtureResponse === true)) return value.shift().response;
  return typeof value === "function" ? value(call) : value;
}

export function fixtureFetch(plan = emptyPlan(), { expectedToken = "inventory-token", trace = [] } = {}) {
  return async (requestUrl, init = {}) => {
    const url = new URL(requestUrl);
    const key = `${url.pathname}${url.search}`;
    const headers = init.headers || {};
    const authorization = headers.Authorization ?? headers.authorization;
    const call = {
      method: init.method,
      path: key,
      redirect: init.redirect,
      hasBody: Object.hasOwn(init, "body"),
      mutationHeader: Object.keys(headers).some((name) => name.toLowerCase() === "x-disable-provenance"),
      authorizationPresent: typeof authorization === "string",
      authorizationEqual: authorization === `Bearer ${expectedToken}`,
    };
    trace.push(call);
    assert.equal(url.origin, WORKSPACE_BASE_URL);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(call.hasBody, false);
    assert.equal(call.mutationHeader, false);
    if (!plan.has(key)) throw new Error(`Unexpected fixture request: ${key}`);
    const selected = routeValue(plan, key, call);
    if (selected?.status !== undefined && selected?.body?.getReader) return selected;
    const response = selected?.response ?? rawResponse({ body: selected, url: requestUrl });
    if (!response.url) Object.defineProperty(response, "url", { value: requestUrl });
    return response;
  };
}

export function publicFixture(plan = emptyPlan(), options = {}) {
  const token = options.token ?? "inventory-token";
  const trace = options.trace ?? [];
  const fetchImpl = fixtureFetch(plan, { expectedToken: token, trace });
  const tokenProvider = options.tokenProvider ?? (() => token);
  return { client: createGrafanaClient({ fetchImpl, tokenProvider }), trace, fetchImpl };
}

export function controlledRuntime({ now = 0, wall = "2026-08-19T00:00:00.000Z" } = {}) {
  let monotonic = now;
  let nextId = 1;
  const timers = new Map();
  return {
    dependencies: {
      wallNow: () => wall,
      monotonicNow: () => monotonic,
      setTimer(callback, delay) { const id = nextId++; timers.set(id, { callback, due: monotonic + delay }); return id; },
      clearTimer(id) { timers.delete(id); },
    },
    set(value) { monotonic = value; },
    advance(amount, fire = true) {
      monotonic += amount;
      if (fire) this.fireDue();
    },
    fireDue() {
      for (const [id, timer] of [...timers]) {
        if (timer.due <= monotonic) { timers.delete(id); timer.callback(); }
      }
    },
    fireLongest() {
      const entry = [...timers].sort((a, b) => b[1].due - a[1].due)[0];
      if (entry) { timers.delete(entry[0]); entry[1].callback(); }
    },
    get timerCount() { return timers.size; },
  };
}

export function internalPrepare(fetchImpl) {
  return async ({ signal, guard }) => {
    guard();
    signal.throwIfAborted();
    return async (path, requestSignal) => {
      const url = `${WORKSPACE_BASE_URL}${path}`;
      const response = await fetchImpl(url, { method: "GET", headers: { Authorization: "Bearer inventory-token" },
        redirect: "manual", signal: requestSignal });
      let targetMatches = false;
      try { targetMatches = new URL(response.url).origin === WORKSPACE_BASE_URL; } catch {}
      return { response, targetMatches };
    };
  };
}

export function surfaceFailure(state, reason, httpStatus) {
  return { state, itemCount: null, reason, ...(httpStatus === undefined ? {} : { httpStatus }) };
}
