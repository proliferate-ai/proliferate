import {
  METADATA_LIMITS,
  metadataFailure,
  completedMetadataItems,
  metadataNormalizers,
} from "./grafana-metadata-normalization.mjs";

const SURFACES = [
  "api", "datasources", "datasourceHealth", "folders", "dashboards", "alertRules",
  "contactPoints", "notificationPolicy", "callerPermissions", "serviceAccounts",
];
const PAGE_NUMBERS = Array.from({ length: METADATA_LIMITS.pagesPerCollection },
  (_, index) => index + 1);
const STATIC_PATHS = [
  "/api/health", "/api/datasources", "/api/ruler/grafana/api/v1/rules",
  "/api/v1/provisioning/contact-points", "/api/v1/provisioning/policies",
  "/api/access-control/user/permissions",
  ...PAGE_NUMBERS.map((page) => `/api/search?type=dash-folder&limit=${METADATA_LIMITS.pageSize}&page=${page}`),
  ...PAGE_NUMBERS.map((page) => `/api/search?type=dash-db&limit=${METADATA_LIMITS.pageSize}&page=${page}`),
  ...PAGE_NUMBERS.map((page) => `/api/serviceaccounts/search?perpage=${METADATA_LIMITS.pageSize}&page=${page}`),
];
const HTTP_CHECKPOINT = Object.freeze({
  FETCH_START: "fetch-start", FETCH_SETTLED: "fetch-settled", CONTENT_LENGTH: "content-length",
  DECLARED_BYTES: "declared-bytes", STREAM_READ: "stream-read", EMPTY_BODY: "empty-body",
  DECODE: "decode", JSON: "json", FINAL_OUTPUT: "final-output",
});
const WHOLE_DEADLINE = Symbol("whole-deadline");
const REQUEST_DEADLINE = Symbol("request-deadline");

function checkpoint(guard, _name) { guard(); }
function safeIntegerAtLeast(value, minimum) { return Number.isSafeInteger(value) && value >= minimum; }

function runtimeFrom(overrides = {}) {
  return {
    wallNow: overrides.wallNow || (() => Date.now()),
    monotonicNow: overrides.monotonicNow || (() => performance.now()),
    setTimer: overrides.setTimer || ((callback, delay) => setTimeout(callback, delay)),
    clearTimer: overrides.clearTimer || ((timer) => clearTimeout(timer)),
  };
}

function deadlineError(kind) { return Object.assign(new Error("Inventory deadline"), { inventoryDeadline: kind }); }

function guardDeadline(aborted, runtime, deadline, expire, kind) {
  if (aborted || runtime.monotonicNow() >= deadline) {
    expire();
    throw deadlineError(kind);
  }
}

// A deadline checkpoint is one atomic observation of the monotonic clock. A
// per-request checkpoint therefore compares that single reading against the
// whole-inventory deadline first and its own derived deadline second; two
// separate readings would let the clock advance inside one checkpoint and let a
// deadline pre-empt a synchronous classification the spec makes atomic.
function guardRequestDeadline(whole, controller, runtime, deadline, expire) {
  if (whole.signal.aborted) { whole.expire(); throw deadlineError(WHOLE_DEADLINE); }
  if (controller.signal.aborted) { expire(); throw deadlineError(REQUEST_DEADLINE); }
  const now = runtime.monotonicNow();
  if (now >= whole.deadline) { whole.expire(); throw deadlineError(WHOLE_DEADLINE); }
  if (now >= deadline) { expire(); throw deadlineError(REQUEST_DEADLINE); }
}

function raceSignal(promise, signal) {
  if (signal.aborted) {
    // Already aborted: no race is installed, so consume and discard the late
    // settlement here. Nothing may surface as an unhandled rejection.
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(signal.reason || deadlineError(REQUEST_DEADLINE));
  }
  let remove = () => {};
  const aborted = new Promise((_, reject) => {
    const onAbort = () => reject(signal.reason || deadlineError(REQUEST_DEADLINE));
    signal.addEventListener("abort", onAbort, { once: true });
    remove = () => signal.removeEventListener("abort", onAbort);
  });
  return Promise.race([promise, aborted]).finally(remove);
}

function createWhole(runtime) {
  const controller = new AbortController();
  const deadline = runtime.monotonicNow() + METADATA_LIMITS.inventoryTimeoutMs;
  const expire = () => {
    if (!controller.signal.aborted) controller.abort(deadlineError(WHOLE_DEADLINE));
  };
  const timer = runtime.setTimer(expire, METADATA_LIMITS.inventoryTimeoutMs);
  const guard = () => guardDeadline(controller.signal.aborted, runtime, deadline, expire,
    WHOLE_DEADLINE);
  return { signal: controller.signal, deadline, guard, expire,
    close: () => runtime.clearTimer(timer) };
}

function createRequest(runtime, whole) {
  whole.guard();
  const controller = new AbortController();
  const startedAt = runtime.monotonicNow();
  const deadline = Math.min(whole.deadline, startedAt + METADATA_LIMITS.requestTimeoutMs);
  const expire = () => {
    if (!controller.signal.aborted) controller.abort(deadlineError(REQUEST_DEADLINE));
  };
  const onWhole = () => controller.abort(deadlineError(WHOLE_DEADLINE));
  whole.signal.addEventListener("abort", onWhole, { once: true });
  const timer = runtime.setTimer(expire, Math.max(0, deadline - startedAt));
  const guard = () => guardRequestDeadline(whole, controller, runtime, deadline, expire);
  const close = () => {
    runtime.clearTimer(timer);
    whole.signal.removeEventListener("abort", onWhole);
  };
  return { signal: controller.signal, guard, close };
}

function isDeadlineError(error) {
  return error?.inventoryDeadline === WHOLE_DEADLINE ||
    error?.inventoryDeadline === REQUEST_DEADLINE;
}

function timeoutFailure(error, httpStatus, body) {
  if (!isDeadlineError(error)) throw error;
  return readFailure(metadataFailure("unavailable", "timeout", httpStatus), body,
    error.inventoryDeadline === WHOLE_DEADLINE);
}

function cancelBody(target) {
  try {
    Promise.resolve(target?.cancel?.()).catch(() => {});
  } catch {
    // Cancellation is best effort and never changes a selected result.
  }
}

function readFailure(result, body, global = false) { cancelBody(body); return { result, global }; }

function byteLimitFailure(responseBytes, totalBytes, body) {
  if (responseBytes > METADATA_LIMITS.responseBytes)
    return readFailure(metadataFailure("unknown", "response_byte_limit", 200), body);
  if (totalBytes > METADATA_LIMITS.totalResponseBytes)
    return readFailure(metadataFailure("unknown", "total_byte_limit", 200), body, true);
  return null;
}

function statusFailure(status, healthChild) {
  if (status >= 300 && status <= 399) return metadataFailure("redirect_refused", "redirect_status", status);
  if (status === 401) return metadataFailure("unauthorized", "http_401", status);
  if (status === 403) return metadataFailure("forbidden", "http_403", status);
  if (status === 404) return healthChild
    ? metadataFailure("unknown", "object_disappeared", status)
    : metadataFailure("unsupported", "endpoint_not_found", status);
  if (status === 405) return metadataFailure(
    "unsupported", healthChild ? "plugin_health_unsupported" : "method_not_allowed", status,
  );
  if (status === 501) return metadataFailure(
    "unsupported", healthChild ? "plugin_health_unsupported" : "not_implemented", status,
  );
  if (status === 408) return metadataFailure("unavailable", "timeout", status);
  if (status === 429) return metadataFailure("rate_limited", "http_429", status);
  if (status >= 500 && status <= 599) return metadataFailure("unavailable", "http_5xx", status);
  if (status === 204) return metadataFailure("malformed", "empty_body", status);
  return metadataFailure("unknown", "unclassified_http_status", status);
}

async function readJson(path, authorizedGet, runtime, whole, budget, healthChild = false) {
  let request;
  let response;
  try {
    request = createRequest(runtime, whole);
    checkpoint(request.guard, HTTP_CHECKPOINT.FETCH_START);
    let received;
    try {
      received = await raceSignal(Promise.resolve(authorizedGet(path, request.signal)), request.signal);
    } catch {
      try { request.guard(); } catch (deadline) { return timeoutFailure(deadline); }
      return readFailure(metadataFailure("unavailable", "network_unavailable"));
    }
    response = received?.response;
    const status = safeIntegerAtLeast(response?.status, 1) ? response.status : undefined;
    if (!received?.targetMatches) {
      return readFailure(metadataFailure("target_mismatch", "origin_mismatch", status), response?.body);
    }
    try { checkpoint(request.guard, HTTP_CHECKPOINT.FETCH_SETTLED); }
    catch (error) { return timeoutFailure(error, status, response?.body); }
    if (status !== 200) return readFailure(statusFailure(status, healthChild), response?.body);

    checkpoint(request.guard, HTTP_CHECKPOINT.CONTENT_LENGTH);
    const declaredText = response.headers?.get?.("content-length") ?? null;
    let declared = null;
    if (declaredText !== null) {
      if (!/^[0-9]+$/.test(declaredText) || !safeIntegerAtLeast(Number(declaredText), 0)) {
        return readFailure(metadataFailure("malformed", "invalid_content_length", 200), response.body);
      }
      declared = Number(declaredText);
    }
    checkpoint(request.guard, HTTP_CHECKPOINT.DECLARED_BYTES);
    const declaredLimit = byteLimitFailure(declared, budget.used + (declared ?? 0), response.body);
    if (declaredLimit) return declaredLimit;

    const reader = response.body?.getReader?.();
    const chunks = [];
    let responseBytes = 0;
    if (reader) {
      while (true) {
        checkpoint(request.guard, HTTP_CHECKPOINT.STREAM_READ);
        let part;
        try {
          part = await raceSignal(Promise.resolve(reader.read()), request.signal);
        } catch {
          try { request.guard(); }
          catch (deadline) { return timeoutFailure(deadline, 200, reader); }
          return readFailure(metadataFailure("unavailable", "network_unavailable", 200), reader);
        }
        try { checkpoint(request.guard, HTTP_CHECKPOINT.STREAM_READ); }
        catch (error) { return timeoutFailure(error, 200, reader); }
        if (part.done) break;
        const chunk = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value);
        responseBytes += chunk.byteLength;
        budget.used += chunk.byteLength;
        const streamedLimit = byteLimitFailure(responseBytes, budget.used, reader);
        if (streamedLimit) return streamedLimit;
        chunks.push(chunk);
      }
    }
    checkpoint(request.guard, HTTP_CHECKPOINT.EMPTY_BODY);
    request.close();
    if (responseBytes === 0) return readFailure(metadataFailure("malformed", "empty_body", 200));
    const bytes = new Uint8Array(responseBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    checkpoint(whole.guard, HTTP_CHECKPOINT.DECODE);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return readFailure(metadataFailure("malformed", "invalid_utf8", 200)); }
    checkpoint(whole.guard, HTTP_CHECKPOINT.JSON);
    try { return { payload: JSON.parse(text), status: 200 }; }
    catch { return readFailure(metadataFailure("malformed", "invalid_json", 200)); }
  } catch (error) {
    return timeoutFailure(error, response ? 200 : undefined, response?.body);
  } finally {
    request?.close();
  }
}

function skeleton(target, queriedAt) {
  return {
    schemaVersion: 1,
    kind: "grafana_metadata_inventory",
    target: { ...target },
    queriedAt,
    freshness: { state: "unknown", sourceTimestamp: null, expectedWithinMs: null,
      reason: "no_authoritative_configuration_freshness_contract" },
    appliedLimits: { ...METADATA_LIMITS },
    surfaces: Object.fromEntries(SURFACES.map((name) => [name, null])),
  };
}

function replaceAll(result, state, reason) {
  for (const name of SURFACES) result.surfaces[name] = metadataFailure(state, reason);
  return result;
}

function stopGlobal(result, current, selected) {
  result.surfaces[current] = selected;
  for (const name of SURFACES) {
    if (result.surfaces[name] === null)
      result.surfaces[name] = metadataFailure(selected.state, selected.reason);
  }
  return true;
}

function recordReadFailure(result, name, read) {
  result.surfaces[name] = read.result;
  return read.global ? stopGlobal(result, name, read.result) : false;
}

function stopNormalizationDeadline(result, name, error) {
  if (error?.inventoryDeadline !== WHOLE_DEADLINE) throw error;
  return stopGlobal(result, name, metadataFailure("unavailable", "timeout", 200));
}

async function direct(result, name, path, normalizer, state, context) {
  const read = await readJson(path, context.get, context.runtime, context.whole, context.budget);
  if (read.result) return recordReadFailure(result, name, read);
  try {
    result.surfaces[name] = normalizer(read.payload, context.whole.guard, state);
  } catch (error) { return stopNormalizationDeadline(result, name, error); }
  return false;
}

async function pagedSearch(result, name, expectedType, context) {
  const items = [];
  let seen = new Set();
  for (let page = 1; page <= METADATA_LIMITS.pagesPerCollection; page += 1) {
    const path = `/api/search?type=${expectedType}&limit=${METADATA_LIMITS.pageSize}&page=${page}`;
    const read = await readJson(path, context.get, context.runtime, context.whole, context.budget);
    if (read.result) return recordReadFailure(result, name, read);
    let normalized;
    try { normalized = metadataNormalizers.searchPage(read.payload, context.whole.guard,
      { expectedType, page, seen }); }
    catch (error) { return stopNormalizationDeadline(result, name, error); }
    if (normalized.state) { result.surfaces[name] = normalized; return false; }
    seen = normalized.seen;
    items.push(...normalized.items);
    if (normalized.complete) { result.surfaces[name] = completedMetadataItems(items, "uid"); return false; }
  }
  return false;
}

async function serviceAccounts(result, context) {
  const items = [];
  let seen = new Set();
  let total = null;
  let rawCount = 0;
  for (let page = 1; page <= METADATA_LIMITS.pagesPerCollection; page += 1) {
    const path = `/api/serviceaccounts/search?perpage=${METADATA_LIMITS.pageSize}&page=${page}`;
    const read = await readJson(path, context.get, context.runtime, context.whole, context.budget);
    if (read.result) return recordReadFailure(result, "serviceAccounts", read);
    let normalized;
    try { normalized = metadataNormalizers.serviceAccountsPage(read.payload, context.whole.guard,
      { requestedPage: page, stableTotal: total, seen, rawCount }); }
    catch (error) { return stopNormalizationDeadline(result, "serviceAccounts", error); }
    if (normalized.state) { result.surfaces.serviceAccounts = normalized; return false; }
    ({ seen, total, rawCount } = normalized);
    items.push(...normalized.items);
    if (normalized.transition === "complete") {
      result.surfaces.serviceAccounts = completedMetadataItems(items, "id"); return false;
    }
  }
  return false;
}

function healthChild(uid, normalized) {
  if (normalized.itemCount !== null) return { uid, state: "ok" };
  const { itemCount: _, ...failure } = normalized;
  return { uid, ...failure };
}

async function datasourceHealth(result, context) {
  const parent = result.surfaces.datasources;
  if (parent.state !== "ok" && parent.state !== "empty") {
    result.surfaces.datasourceHealth = metadataFailure("unknown", "prerequisite_failed");
    return false;
  }
  if (parent.items.length === 0) {
    result.surfaces.datasourceHealth = completedMetadataItems([]); return false;
  }
  if (parent.items.length > METADATA_LIMITS.datasourceHealthSources) {
    result.surfaces.datasourceHealth = metadataFailure("unknown", "item_limit");
    return false;
  }
  const items = [];
  for (const datasource of parent.items) {
    const path = `/api/datasources/uid/${encodeURIComponent(datasource.uid)}/health`;
    const read = await readJson(path, context.get, context.runtime, context.whole,
      context.budget, true);
    if (read.result) {
      if (read.global) return stopGlobal(result, "datasourceHealth", read.result);
      items.push(healthChild(datasource.uid, read.result));
      continue;
    }
    let normalized;
    try { normalized = metadataNormalizers.datasourceHealth(read.payload, context.whole.guard); }
    catch (error) { return stopNormalizationDeadline(result, "datasourceHealth", error); }
    items.push(healthChild(datasource.uid, normalized));
  }
  result.surfaces.datasourceHealth = completedMetadataItems(items);
  return false;
}

export async function readMetadataInventoryInternal({
  target,
  prepareAuthorizedGet,
  productionClockAndTimers,
}) {
  const runtime = runtimeFrom(productionClockAndTimers);
  const queriedAt = new Date(runtime.wallNow()).toISOString();
  const result = skeleton(target, queriedAt);
  const whole = createWhole(runtime);
  try {
    let get;
    try {
      get = await raceSignal(Promise.resolve(prepareAuthorizedGet({
        signal: whole.signal,
        guard: whole.guard,
        staticPaths: STATIC_PATHS,
        credentialBytes: METADATA_LIMITS.credentialBytes,
      })), whole.signal);
      whole.guard();
    } catch (error) {
      if (error?.code === "GRAFANA_TARGET_MISMATCH")
        return replaceAll(result, "target_mismatch", "origin_mismatch");
      return replaceAll(result, "unavailable", "credential_unavailable");
    }
    const context = { get, runtime, whole, budget: { used: 0 } };
    if (await direct(result, "api", "/api/health", metadataNormalizers.api,
      { expectedVersion: target.expectedGrafanaVersion }, context)) return result;
    if (await direct(result, "datasources", "/api/datasources",
      metadataNormalizers.datasources, undefined, context)) return result;
    if (await pagedSearch(result, "folders", "dash-folder", context)) return result;
    if (await pagedSearch(result, "dashboards", "dash-db", context)) return result;
    if (await direct(result, "alertRules", "/api/ruler/grafana/api/v1/rules",
      metadataNormalizers.alertRules, undefined, context)) return result;
    if (await direct(result, "contactPoints", "/api/v1/provisioning/contact-points",
      metadataNormalizers.contactPoints, undefined, context)) return result;
    if (await direct(result, "notificationPolicy", "/api/v1/provisioning/policies",
      metadataNormalizers.notificationPolicy, undefined, context)) return result;
    if (await direct(result, "callerPermissions", "/api/access-control/user/permissions",
      metadataNormalizers.callerPermissions, undefined, context)) return result;
    if (await serviceAccounts(result, context)) return result;
    if (await datasourceHealth(result, context)) return result;
    try {
      checkpoint(whole.guard, HTTP_CHECKPOINT.FINAL_OUTPUT);
    } catch (error) {
      if (error?.inventoryDeadline !== WHOLE_DEADLINE) throw error;
      return replaceAll(result, "unavailable", "timeout");
    }
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > METADATA_LIMITS.normalizedOutputBytes) {
      return replaceAll(result, "unknown", "output_byte_limit");
    }
    return result;
  } finally {
    whole.close();
  }
}
