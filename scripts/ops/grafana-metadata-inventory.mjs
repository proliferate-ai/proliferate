const LIMITS = Object.freeze({
  requestTimeoutMs: 5_000, inventoryTimeoutMs: 30_000, credentialBytes: 8_192,
  responseBytes: 524_288, totalResponseBytes: 4_194_304, pageSize: 100,
  pagesPerCollection: 5, itemsPerCollection: 500, requestCount: 37,
  datasourceHealthSources: 16, metadataStringBytes: 256, dynamicKeysPerMap: 64,
  policyRouteNodes: 500, policyDepth: 32, normalizedOutputBytes: 1_048_576,
});
const SURFACES = [
  "api", "datasources", "datasourceHealth", "folders", "dashboards", "alertRules",
  "contactPoints", "notificationPolicy", "callerPermissions", "serviceAccounts",
];
const PERMISSIONS = new Set([
  "datasources:read", "datasources:query", "folders:read", "dashboards:read",
  "alert.rules:read", "alert.provisioning:read", "serviceaccounts:read",
]);
const PAGE_NUMBERS = Array.from({ length: 5 }, (_, index) => index + 1);
const STATIC_PATHS = [
  "/api/health", "/api/datasources", "/api/ruler/grafana/api/v1/rules",
  "/api/v1/provisioning/contact-points", "/api/v1/provisioning/policies",
  "/api/access-control/user/permissions",
  ...PAGE_NUMBERS.map((page) => `/api/search?type=dash-folder&limit=100&page=${page}`),
  ...PAGE_NUMBERS.map((page) => `/api/search?type=dash-db&limit=100&page=${page}`),
  ...PAGE_NUMBERS.map((page) => `/api/serviceaccounts/search?perpage=100&page=${page}`),
];
const PARSED_ROW = Object.freeze({
  ENVELOPE: 1, API_STATE: 2, PAGE_LIMIT: 3, ITEM_LIMIT: 4, DEPTH_LIMIT: 5, KEY_LIMIT: 6,
  SHAPE: 7, STRING_LIMIT: 8, HEALTH_STATE: 9, PROJECT: 10,
});
const HTTP_CHECKPOINT = Object.freeze({
  FETCH_START: "fetch-start", FETCH_SETTLED: "fetch-settled", CONTENT_LENGTH: "content-length",
  DECLARED_BYTES: "declared-bytes", STREAM_READ: "stream-read", EMPTY_BODY: "empty-body",
  DECODE: "decode", JSON: "json", FINAL_OUTPUT: "final-output",
});
const WHOLE_DEADLINE = Symbol("whole-deadline");
const REQUEST_DEADLINE = Symbol("request-deadline");
function failure(state, reason, httpStatus) {
  return { state, itemCount: null, reason,
    ...(httpStatus === undefined ? {} : { httpStatus }) };
}
function completed(items) {
  return items.length === 0
    ? { state: "empty", itemCount: 0, items: [] }
    : { state: "ok", itemCount: items.length, items };
}
function completedSorted(items, compare = (a, b) => compareUtf8(a.uid, b.uid)) {
  items.sort(compare);
  return completed(items);
}
function parsedFailure(state, reason) { return failure(state, reason, 200); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isWellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function validString(value, nullable = false) {
  return (nullable && value === null) ||
    (typeof value === "string" && value.length > 0 && isWellFormed(value));
}
function withinStringLimit(value) {
  return value === null || Buffer.byteLength(value, "utf8") <= LIMITS.metadataStringBytes;
}
function compareUtf8(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}
function safeIntegerAtLeast(value, minimum) { return Number.isSafeInteger(value) && value >= minimum; }
function validDatasourceUid(uid) {
  return uid !== "." && uid !== ".." && !/[\\/?#\s\u0000-\u001f\u007f]/u.test(uid);
}
function checkpoint(guard, _name) {
  guard();
}
// Visit every numbered row in the inclusive range, including inapplicable rows.
function parsedRows(guard, first, last = first) {
  for (let row = first; row <= last; row += 1) guard();
}
function orderedKeysForRow7(map) {
  const keys = Object.keys(map);
  if (!keys.every(isWellFormed)) return null;
  keys.sort(compareUtf8);
  return keys;
}
function keysSatisfy(keys, guard, predicate) {
  for (const key of keys) { guard(); if (!predicate(key)) return false; }
  return true;
}
function nonEmptyKey(key) { return key.length > 0; }
function apiResult(payload, guard, expectedVersion) {
  parsedRows(guard, PARSED_ROW.ENVELOPE);
  if (!isObject(payload) || typeof payload.database !== "string") return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.API_STATE);
  if (payload.database !== "ok") return parsedFailure("unavailable", "api_database_not_ok");
  parsedRows(guard, PARSED_ROW.PAGE_LIMIT, PARSED_ROW.SHAPE);
  const hasVersion = Object.hasOwn(payload, "version"); const version = hasVersion ? payload.version : null;
  if (hasVersion && !validString(version)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.STRING_LIMIT);
  if (!withinStringLimit(version)) return parsedFailure("malformed", "string_limit");
  parsedRows(guard, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return completed([{
    databaseOk: true,
    version,
    versionMatchesExpected: version === null
      ? null
      : version === expectedVersion || version.startsWith(`${expectedVersion}.`),
  }]);
}
function datasourceResult(payload, guard) {
  parsedRows(guard, PARSED_ROW.ENVELOPE);
  if (!Array.isArray(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.API_STATE, PARSED_ROW.ITEM_LIMIT);
  if (payload.length > LIMITS.itemsPerCollection) return parsedFailure("unknown", "item_limit");
  parsedRows(guard, PARSED_ROW.DEPTH_LIMIT, PARSED_ROW.SHAPE);
  const seen = new Set();
  for (const item of payload) {
    guard();
    if (!isObject(item) || !validString(item.uid) || !validString(item.name) ||
        !validString(item.type) || !validString(item.access) ||
        typeof item.isDefault !== "boolean" || typeof item.readOnly !== "boolean" ||
        !validDatasourceUid(item.uid) || seen.has(item.uid)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    seen.add(item.uid);
  }
  parsedRows(guard, PARSED_ROW.STRING_LIMIT);
  for (const item of payload) {
    guard();
    if (![item.uid, item.name, item.type, item.access].every(withinStringLimit)) {
      return parsedFailure("malformed", "string_limit");
    }
  }
  parsedRows(guard, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  const items = payload.map(({ uid, name, type, access, isDefault, readOnly }) =>
    ({ uid, name, type, access, isDefault, readOnly }));
  return completedSorted(items);
}
function searchPageResult(payload, guard, expectedType, page, seen) {
  parsedRows(guard, PARSED_ROW.ENVELOPE);
  if (!Array.isArray(payload) || payload.length > LIMITS.pageSize) return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.API_STATE, PARSED_ROW.PAGE_LIMIT);
  if (page === LIMITS.pagesPerCollection && payload.length === LIMITS.pageSize) {
    return parsedFailure("unknown", "page_limit");
  }
  parsedRows(guard, PARSED_ROW.ITEM_LIMIT, PARSED_ROW.SHAPE);
  const items = [];
  for (const item of payload) {
    guard();
    const folderUid = expectedType === "dash-db" && Object.hasOwn(item || {}, "folderUid")
      ? item.folderUid
      : null;
    if (!isObject(item) || item.type !== expectedType || !validString(item.uid) ||
        !validString(item.title) || !validString(folderUid, true) || seen.has(item.uid)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    seen.add(item.uid);
    items.push(expectedType === "dash-db"
      ? { uid: item.uid, title: item.title, folderUid }
      : { uid: item.uid, title: item.title });
  }
  parsedRows(guard, PARSED_ROW.STRING_LIMIT);
  for (const item of items) {
    guard();
    if (![item.uid, item.title, ...(Object.hasOwn(item, "folderUid") ? [item.folderUid] : [])]
      .every(withinStringLimit)) return parsedFailure("malformed", "string_limit");
  }
  parsedRows(guard, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return { items, complete: payload.length < LIMITS.pageSize };
}
function rulerExceedsItemLimit(payload, guard) {
  let count = 0;
  for (const groups of Object.values(payload)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      guard();
      if (isObject(group) && Array.isArray(group.rules)) {
        count += group.rules.length;
        if (count > LIMITS.itemsPerCollection) return true;
      }
    }
  }
  return false;
}
function rulerMapKeyLimit(payload, guard) {
  if (Object.keys(payload).length > LIMITS.dynamicKeysPerMap) return true;
  for (const groups of Object.values(payload)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      guard();
      if (!isObject(group) || !Array.isArray(group.rules)) continue;
      for (const entry of group.rules) {
        guard();
        if (!isObject(entry)) continue;
        for (const map of [entry.labels, entry.annotations]) {
          if (isObject(map) && Object.keys(map).length > LIMITS.dynamicKeysPerMap) return true;
        }
      }
    }
  }
  return false;
}
function alertRulesResult(payload, guard) {
  parsedRows(guard, PARSED_ROW.ENVELOPE);
  if (!isObject(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.API_STATE, PARSED_ROW.ITEM_LIMIT);
  if (rulerExceedsItemLimit(payload, guard)) return parsedFailure("unknown", "item_limit");
  parsedRows(guard, PARSED_ROW.DEPTH_LIMIT, PARSED_ROW.KEY_LIMIT);
  if (rulerMapKeyLimit(payload, guard)) return parsedFailure("unknown", "key_limit");
  parsedRows(guard, PARSED_ROW.SHAPE);
  const namespaces = orderedKeysForRow7(payload);
  if (!namespaces) return parsedFailure("malformed", "invalid_shape");
  const seen = new Set();
  const staged = [];
  for (const namespace of namespaces) {
    guard();
    if (namespace.length === 0) return parsedFailure("malformed", "invalid_shape");
    const groups = payload[namespace];
    if (!Array.isArray(groups)) return parsedFailure("malformed", "invalid_shape");
    for (const group of groups) {
      guard();
      if (!isObject(group) || !Array.isArray(group.rules)) return parsedFailure("malformed", "invalid_shape");
      for (const entry of group.rules) {
        guard();
        const ga = entry?.grafana_alert;
        const labels = isObject(entry) && Object.hasOwn(entry, "labels") ? entry.labels : {};
        const annotations = isObject(entry) && Object.hasOwn(entry, "annotations") ? entry.annotations : {};
        if (!isObject(entry) || !isObject(ga) || !isObject(labels) || !isObject(annotations) ||
            !validString(ga.uid) || !validString(ga.title) || seen.has(ga.uid)) {
          return parsedFailure("malformed", "invalid_shape");
        }
        const nullable = [ga.namespace_uid ?? null, ga.rule_group ?? null,
          ga.no_data_state ?? null, ga.exec_err_state ?? null];
        if (!nullable.every((value) => validString(value, true)) ||
            (Object.hasOwn(ga, "is_paused") && typeof ga.is_paused !== "boolean")) {
          return parsedFailure("malformed", "invalid_shape");
        }
        const labelKeys = orderedKeysForRow7(labels);
        const annotationKeys = orderedKeysForRow7(annotations);
        if (!labelKeys || !annotationKeys || !keysSatisfy(labelKeys, guard, nonEmptyKey) ||
            !keysSatisfy(annotationKeys, guard, nonEmptyKey)) {
          return parsedFailure("malformed", "invalid_shape");
        }
        seen.add(ga.uid);
        staged.push({ ga, labelKeys, annotationKeys });
      }
    }
  }
  parsedRows(guard, PARSED_ROW.STRING_LIMIT);
  if (!keysSatisfy(namespaces, guard, withinStringLimit)) return parsedFailure("malformed", "string_limit");
  for (const { ga, labelKeys, annotationKeys } of staged) {
    guard();
    if (![ga.uid, ga.title, ga.namespace_uid ?? null, ga.rule_group ?? null,
      ga.no_data_state ?? null, ga.exec_err_state ?? null].every(withinStringLimit) ||
      !keysSatisfy(labelKeys, guard, withinStringLimit) ||
      !keysSatisfy(annotationKeys, guard, withinStringLimit)) {
      return parsedFailure("malformed", "string_limit");
    }
  }
  parsedRows(guard, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  const items = staged.map(({ ga, labelKeys, annotationKeys }) => ({
    uid: ga.uid,
    title: ga.title,
    folderUid: ga.namespace_uid ?? null,
    ruleGroup: ga.rule_group ?? null,
    isPaused: ga.is_paused ?? false,
    noDataState: ga.no_data_state ?? null,
    execErrState: ga.exec_err_state ?? null,
    labelKeys,
    annotationKeys,
  }));
  return completedSorted(items);
}
function contactPointsResult(payload, guard) {
  parsedRows(guard, PARSED_ROW.ENVELOPE);
  if (!Array.isArray(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.API_STATE, PARSED_ROW.ITEM_LIMIT);
  if (payload.length > LIMITS.itemsPerCollection) return parsedFailure("unknown", "item_limit");
  parsedRows(guard, PARSED_ROW.DEPTH_LIMIT, PARSED_ROW.KEY_LIMIT);
  for (const item of payload) {
    guard();
    if (isObject(item?.settings) && Object.keys(item.settings).length > LIMITS.dynamicKeysPerMap) {
      return parsedFailure("unknown", "key_limit");
    }
  }
  parsedRows(guard, PARSED_ROW.SHAPE);
  const seen = new Set();
  const staged = [];
  for (const item of payload) {
    guard();
    if (!isObject(item) || !validString(item.uid) || !validString(item.name) ||
        !validString(item.type) || !isObject(item.settings) || seen.has(item.uid) ||
        (Object.hasOwn(item, "disableResolveMessage") && typeof item.disableResolveMessage !== "boolean")) {
      return parsedFailure("malformed", "invalid_shape");
    }
    const settingKeys = orderedKeysForRow7(item.settings);
    if (!settingKeys || !keysSatisfy(settingKeys, guard, nonEmptyKey)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    seen.add(item.uid);
    staged.push({ item, settingKeys });
  }
  parsedRows(guard, PARSED_ROW.STRING_LIMIT);
  for (const { item, settingKeys } of staged) {
    guard();
    if (![item.uid, item.name, item.type].every(withinStringLimit) ||
        !keysSatisfy(settingKeys, guard, withinStringLimit)) {
      return parsedFailure("malformed", "string_limit");
    }
  }
  parsedRows(guard, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  const items = staged.map(({ item, settingKeys }) => ({
    uid: item.uid,
    name: item.name,
    type: item.type,
    disableResolveMessage: item.disableResolveMessage ?? false,
    settingKeys,
  }));
  return completedSorted(items);
}
function walkPolicy(root, guard, visitor) {
  const stack = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    guard();
    const current = stack.pop();
    if (visitor(current.node, current.depth) === false) return false;
    if (isObject(current.node) && Array.isArray(current.node.routes)) {
      for (let index = current.node.routes.length - 1; index >= 0; index -= 1) {
        stack.push({ node: current.node.routes[index], depth: current.depth + 1 });
      }
    }
  }
  return true;
}
function notificationPolicyResult(payload, guard) {
  parsedRows(guard, PARSED_ROW.ENVELOPE);
  if (!isObject(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.API_STATE, PARSED_ROW.ITEM_LIMIT);
  let routeCount = 0;
  if (!walkPolicy(payload, guard, () => (++routeCount <= LIMITS.policyRouteNodes))) {
    return parsedFailure("unknown", "item_limit");
  }
  parsedRows(guard, PARSED_ROW.DEPTH_LIMIT);
  let maxDepth = 0;
  if (!walkPolicy(payload, guard, (_, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    return depth <= LIMITS.policyDepth;
  })) return parsedFailure("unknown", "depth_limit");
  parsedRows(guard, PARSED_ROW.KEY_LIMIT, PARSED_ROW.SHAPE);
  const receiverNames = new Set();
  const valid = walkPolicy(payload, guard, (node) => {
    if (!isObject(node) || !validString(node.receiver) ||
        (Object.hasOwn(node, "routes") && !Array.isArray(node.routes))) return false;
    receiverNames.add(node.receiver);
    return true;
  });
  if (!valid) return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.STRING_LIMIT);
  if (!walkPolicy(payload, guard, (node) => withinStringLimit(node.receiver))) {
    return parsedFailure("malformed", "string_limit");
  }
  parsedRows(guard, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return completed([{
    rootReceiver: payload.receiver,
    receiverNames: [...receiverNames].sort(compareUtf8),
    routeCount,
    maxDepth,
  }]);
}
function callerPermissionsResult(payload, guard) {
  parsedRows(guard, PARSED_ROW.ENVELOPE);
  if (!isObject(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.API_STATE, PARSED_ROW.KEY_LIMIT);
  if (Object.keys(payload).length > LIMITS.dynamicKeysPerMap) return parsedFailure("unknown", "key_limit");
  parsedRows(guard, PARSED_ROW.SHAPE);
  const keys = orderedKeysForRow7(payload);
  if (!keys) return parsedFailure("malformed", "invalid_shape");
  const items = [];
  for (const action of keys) {
    guard();
    if (action.length === 0) return parsedFailure("malformed", "invalid_shape");
    if (!PERMISSIONS.has(action)) continue;
    if (!Array.isArray(payload[action]) || !safeIntegerAtLeast(payload[action].length, 0)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    items.push({ action, scopeCount: payload[action].length });
  }
  parsedRows(guard, PARSED_ROW.STRING_LIMIT);
  if (!keysSatisfy(keys, guard, withinStringLimit)) return parsedFailure("malformed", "string_limit");
  parsedRows(guard, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return completedSorted(items, (a, b) => compareUtf8(a.action, b.action));
}
function serviceAccountPageResult(payload, guard, requestedPage, stableTotal, seen, rawCount) {
  parsedRows(guard, PARSED_ROW.ENVELOPE);
  if (!isObject(payload) || !Array.isArray(payload.serviceAccounts) ||
      payload.serviceAccounts.length > LIMITS.pageSize || payload.page !== requestedPage ||
      payload.perPage !== LIMITS.pageSize || !safeIntegerAtLeast(payload.page, 1) ||
      !safeIntegerAtLeast(payload.perPage, 1) || !safeIntegerAtLeast(payload.totalCount, 0) ||
      (stableTotal !== null && payload.totalCount !== stableTotal)) {
    return parsedFailure("malformed", "invalid_shape");
  }
  parsedRows(guard, PARSED_ROW.API_STATE, PARSED_ROW.ITEM_LIMIT);
  if (payload.totalCount > LIMITS.itemsPerCollection) return parsedFailure("unknown", "item_limit");
  parsedRows(guard, PARSED_ROW.DEPTH_LIMIT, PARSED_ROW.SHAPE);
  const items = [];
  for (const account of payload.serviceAccounts) {
    guard();
    if (!isObject(account) || !safeIntegerAtLeast(account.id, 1) || !validString(account.name) ||
        !validString(account.role) || typeof account.isDisabled !== "boolean" ||
        !safeIntegerAtLeast(account.tokens, 0) || seen.has(account.id)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    seen.add(account.id);
    items.push({ id: account.id, name: account.name, role: account.role,
      isDisabled: account.isDisabled, tokenCount: account.tokens });
  }
  const nextRaw = rawCount + payload.serviceAccounts.length;
  const unique = seen.size;
  const total = payload.totalCount;
  let transition;
  if (nextRaw > total || unique > total || nextRaw !== unique) transition = "invalid";
  else if (nextRaw === total) transition = "complete";
  else if (payload.serviceAccounts.length === LIMITS.pageSize && requestedPage < LIMITS.pagesPerCollection) transition = "continue";
  else transition = "invalid";
  if (transition === "invalid") return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.STRING_LIMIT);
  for (const item of items) {
    guard();
    if (![item.name, item.role].every(withinStringLimit)) return parsedFailure("malformed", "string_limit");
  }
  parsedRows(guard, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return { items, total, rawCount: nextRaw, transition };
}
function healthResult(payload, guard) {
  parsedRows(guard, PARSED_ROW.ENVELOPE);
  if (!isObject(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(guard, PARSED_ROW.API_STATE, PARSED_ROW.SHAPE);
  if (typeof payload.status !== "string" || !isWellFormed(payload.status)) {
    return parsedFailure("malformed", "invalid_shape");
  }
  parsedRows(guard, PARSED_ROW.STRING_LIMIT);
  if (!withinStringLimit(payload.status)) return parsedFailure("malformed", "string_limit");
  parsedRows(guard, PARSED_ROW.HEALTH_STATE);
  if (payload.status !== "OK") return parsedFailure("unavailable", "datasource_health_failed");
  parsedRows(guard, PARSED_ROW.PROJECT);
  return { state: "ok" };
}
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
function raceSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || deadlineError(REQUEST_DEADLINE));
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
  const deadline = runtime.monotonicNow() + LIMITS.inventoryTimeoutMs;
  const expire = () => {
    if (!controller.signal.aborted) controller.abort(deadlineError(WHOLE_DEADLINE));
  };
  const timer = runtime.setTimer(expire, LIMITS.inventoryTimeoutMs);
  const guard = () => guardDeadline(controller.signal.aborted, runtime, deadline, expire,
    WHOLE_DEADLINE);
  return { signal: controller.signal, deadline, guard, expire, close: () => runtime.clearTimer(timer) };
}
function createRequest(runtime, whole) {
  whole.guard();
  const controller = new AbortController();
  const deadline = Math.min(whole.deadline, runtime.monotonicNow() + LIMITS.requestTimeoutMs);
  const expire = () => {
    if (!controller.signal.aborted) controller.abort(deadlineError(REQUEST_DEADLINE));
  };
  const onWhole = () => controller.abort(deadlineError(WHOLE_DEADLINE));
  whole.signal.addEventListener("abort", onWhole, { once: true });
  const timer = runtime.setTimer(expire, Math.max(0, deadline - runtime.monotonicNow()));
  const guard = () => {
    guardDeadline(whole.signal.aborted, runtime, whole.deadline, whole.expire, WHOLE_DEADLINE);
    guardDeadline(controller.signal.aborted, runtime, deadline, expire, REQUEST_DEADLINE);
  };
  const close = () => {
    runtime.clearTimer(timer);
    whole.signal.removeEventListener("abort", onWhole);
  };
  return { signal: controller.signal, guard, close };
}
function isDeadlineError(error) {
  return error?.inventoryDeadline === WHOLE_DEADLINE || error?.inventoryDeadline === REQUEST_DEADLINE;
}
function timeoutFailure(error, httpStatus, body) {
  if (!isDeadlineError(error)) throw error;
  return readFailure(failure("unavailable", "timeout", httpStatus), body,
    error.inventoryDeadline === WHOLE_DEADLINE);
}
function cancelBody(target) {
  try {
    Promise.resolve(target?.cancel?.()).catch(() => {});
  } catch {
    // Cancellation is best effort and never changes a selected result.
  }
}
function readFailure(result, body, global = false) {
  cancelBody(body);
  return { result, global };
}
function byteLimitFailure(responseBytes, totalBytes, body) {
  if (responseBytes > LIMITS.responseBytes) return readFailure(failure("unknown", "response_byte_limit", 200), body);
  if (totalBytes > LIMITS.totalResponseBytes) return readFailure(failure("unknown", "total_byte_limit", 200), body, true);
  return null;
}
function statusFailure(status, healthChild) {
  if (status >= 300 && status <= 399) return failure("redirect_refused", "redirect_status", status);
  if (status === 401) return failure("unauthorized", "http_401", status);
  if (status === 403) return failure("forbidden", "http_403", status);
  if (status === 404) return healthChild
    ? failure("unknown", "object_disappeared", status)
    : failure("unsupported", "endpoint_not_found", status);
  if (status === 405) return failure("unsupported", healthChild ? "plugin_health_unsupported" : "method_not_allowed", status);
  if (status === 501) return failure("unsupported", healthChild ? "plugin_health_unsupported" : "not_implemented", status);
  if (status === 408) return failure("unavailable", "timeout", status);
  if (status === 429) return failure("rate_limited", "http_429", status);
  if (status >= 500 && status <= 599) return failure("unavailable", "http_5xx", status);
  if (status === 204) return failure("malformed", "empty_body", status);
  return failure("unknown", "unclassified_http_status", status);
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
    } catch (error) {
      try { request.guard(); } catch (deadline) { return timeoutFailure(deadline); }
      return readFailure(failure("unavailable", "network_unavailable"));
    }
    response = received?.response;
    const status = safeIntegerAtLeast(response?.status, 1) ? response.status : undefined;
    if (!received?.targetMatches) {
      return readFailure(failure("target_mismatch", "origin_mismatch", status), response?.body);
    }
    try { checkpoint(request.guard, HTTP_CHECKPOINT.FETCH_SETTLED); }
    catch (error) { return timeoutFailure(error, status, response?.body); }
    if (status !== 200) {
      return readFailure(statusFailure(status, healthChild), response?.body);
    }
    checkpoint(request.guard, HTTP_CHECKPOINT.CONTENT_LENGTH);
    const declaredText = response.headers?.get?.("content-length") ?? null;
    let declared = null;
    if (declaredText !== null) {
      if (!/^[0-9]+$/.test(declaredText) || !safeIntegerAtLeast(Number(declaredText), 0)) {
        return readFailure(failure("malformed", "invalid_content_length", 200), response.body);
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
        try { part = await raceSignal(Promise.resolve(reader.read()), request.signal); }
        catch (error) {
          try { request.guard(); } catch (deadline) { return timeoutFailure(deadline, 200, reader); }
          return readFailure(failure("unavailable", "network_unavailable", 200), reader);
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
    if (responseBytes === 0) return readFailure(failure("malformed", "empty_body", 200));
    const bytes = new Uint8Array(responseBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    checkpoint(whole.guard, HTTP_CHECKPOINT.DECODE);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return readFailure(failure("malformed", "invalid_utf8", 200)); }
    checkpoint(whole.guard, HTTP_CHECKPOINT.JSON);
    try { return { payload: JSON.parse(text), status: 200 }; }
    catch { return readFailure(failure("malformed", "invalid_json", 200)); }
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
    appliedLimits: { ...LIMITS },
    surfaces: Object.fromEntries(SURFACES.map((name) => [name, null])),
  };
}
function replaceAll(result, state, reason) {
  for (const name of SURFACES) result.surfaces[name] = failure(state, reason);
  return result;
}
function stopGlobal(result, current, selected) {
  result.surfaces[current] = selected;
  for (const name of SURFACES) {
    if (result.surfaces[name] === null) result.surfaces[name] = failure(selected.state, selected.reason);
  }
  return true;
}
function recordReadFailure(result, name, read) {
  result.surfaces[name] = read.result;
  return read.global ? stopGlobal(result, name, read.result) : false;
}
function stopNormalizationDeadline(result, name, error) {
  if (error?.inventoryDeadline !== WHOLE_DEADLINE) throw error;
  return stopGlobal(result, name, failure("unavailable", "timeout", 200));
}
async function direct(result, name, path, normalizer, context) {
  const read = await readJson(path, context.get, context.runtime, context.whole, context.budget);
  if (read.result) return recordReadFailure(result, name, read);
  try { result.surfaces[name] = normalizer(read.payload, context.whole.guard); }
  catch (error) { return stopNormalizationDeadline(result, name, error); }
  return false;
}
async function pagedSearch(result, name, type, context) {
  const items = [];
  const seen = new Set();
  for (let page = 1; page <= LIMITS.pagesPerCollection; page += 1) {
    const path = `/api/search?type=${type}&limit=100&page=${page}`;
    const read = await readJson(path, context.get, context.runtime, context.whole, context.budget);
    if (read.result) return recordReadFailure(result, name, read);
    let normalized;
    try { normalized = searchPageResult(read.payload, context.whole.guard, type, page, seen); }
    catch (error) { return stopNormalizationDeadline(result, name, error); }
    if (normalized.state) { result.surfaces[name] = normalized; return false; }
    items.push(...normalized.items);
    if (normalized.complete) {
      result.surfaces[name] = completedSorted(items);
      return false;
    }
  }
  return false;
}
async function serviceAccounts(result, context) {
  const items = [];
  const seen = new Set();
  let total = null;
  let rawCount = 0;
  for (let page = 1; page <= LIMITS.pagesPerCollection; page += 1) {
    const path = `/api/serviceaccounts/search?perpage=100&page=${page}`;
    const read = await readJson(path, context.get, context.runtime, context.whole, context.budget);
    if (read.result) return recordReadFailure(result, "serviceAccounts", read);
    let normalized;
    try { normalized = serviceAccountPageResult(read.payload, context.whole.guard, page, total, seen, rawCount); }
    catch (error) { return stopNormalizationDeadline(result, "serviceAccounts", error); }
    if (normalized.state) { result.surfaces.serviceAccounts = normalized; return false; }
    ({ total, rawCount } = normalized);
    items.push(...normalized.items);
    if (normalized.transition === "complete") {
      result.surfaces.serviceAccounts = completedSorted(items, (a, b) => a.id - b.id);
      return false;
    }
  }
  return false;
}
async function datasourceHealth(result, context) {
  const parent = result.surfaces.datasources;
  if (parent.state !== "ok" && parent.state !== "empty") {
    result.surfaces.datasourceHealth = failure("unknown", "prerequisite_failed");
    return false;
  }
  if (parent.items.length === 0) { result.surfaces.datasourceHealth = completed([]); return false; }
  if (parent.items.length > LIMITS.datasourceHealthSources) {
    result.surfaces.datasourceHealth = failure("unknown", "item_limit");
    return false;
  }
  const items = [];
  for (const datasource of parent.items) {
    const path = `/api/datasources/uid/${encodeURIComponent(datasource.uid)}/health`;
    const read = await readJson(path, context.get, context.runtime, context.whole, context.budget, true);
    if (read.result) {
      if (read.global) return stopGlobal(result, "datasourceHealth", read.result);
      items.push({ uid: datasource.uid, ...read.result });
      delete items.at(-1).itemCount;
      continue;
    }
    let child;
    try { child = healthResult(read.payload, context.whole.guard); }
    catch (error) { return stopNormalizationDeadline(result, "datasourceHealth", error); }
    if (child.itemCount === null) {
      const { itemCount: _, ...withoutCount } = child;
      items.push({ uid: datasource.uid, ...withoutCount });
    } else items.push({ uid: datasource.uid, state: "ok" });
  }
  result.surfaces.datasourceHealth = completed(items);
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
      })), whole.signal);
      whole.guard();
    } catch (error) {
      if (error?.code === "GRAFANA_TARGET_MISMATCH") return replaceAll(result, "target_mismatch", "origin_mismatch");
      return replaceAll(result, "unavailable", "credential_unavailable");
    }
    const context = { get, runtime, whole, budget: { used: 0 } };
    if (await direct(result, "api", "/api/health", (body, guard) =>
      apiResult(body, guard, target.expectedGrafanaVersion), context)) return result;
    if (await direct(result, "datasources", "/api/datasources", datasourceResult, context)) return result;
    if (await pagedSearch(result, "folders", "dash-folder", context)) return result;
    if (await pagedSearch(result, "dashboards", "dash-db", context)) return result;
    if (await direct(result, "alertRules", "/api/ruler/grafana/api/v1/rules", alertRulesResult, context)) return result;
    if (await direct(result, "contactPoints", "/api/v1/provisioning/contact-points", contactPointsResult, context)) return result;
    if (await direct(result, "notificationPolicy", "/api/v1/provisioning/policies", notificationPolicyResult, context)) return result;
    if (await direct(result, "callerPermissions", "/api/access-control/user/permissions", callerPermissionsResult, context)) return result;
    if (await serviceAccounts(result, context)) return result;
    if (await datasourceHealth(result, context)) return result;
    try { checkpoint(whole.guard, HTTP_CHECKPOINT.FINAL_OUTPUT); }
    catch (error) {
      if (error?.inventoryDeadline !== WHOLE_DEADLINE) throw error;
      return replaceAll(result, "unavailable", "timeout");
    }
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > LIMITS.normalizedOutputBytes) {
      return replaceAll(result, "unknown", "output_byte_limit");
    }
    return result;
  } finally {
    whole.close();
  }
}
