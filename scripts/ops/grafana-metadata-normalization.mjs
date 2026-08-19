export const METADATA_LIMITS = Object.freeze({
  requestTimeoutMs: 5_000, inventoryTimeoutMs: 30_000, credentialBytes: 8_192,
  responseBytes: 524_288, totalResponseBytes: 4_194_304, pageSize: 100,
  pagesPerCollection: 5, itemsPerCollection: 500, requestCount: 37,
  datasourceHealthSources: 16, metadataStringBytes: 256, dynamicKeysPerMap: 64,
  policyRouteNodes: 500, policyDepth: 32, normalizedOutputBytes: 1_048_576,
});

const PERMISSIONS = new Set([
  "datasources:read", "datasources:query", "folders:read", "dashboards:read",
  "alert.rules:read", "alert.provisioning:read", "serviceaccounts:read",
]);
const PARSED_ROW = Object.freeze({
  ENVELOPE: 1, API_STATE: 2, PAGE_LIMIT: 3, ITEM_LIMIT: 4, DEPTH_LIMIT: 5,
  KEY_LIMIT: 6, SHAPE: 7, STRING_LIMIT: 8, HEALTH_STATE: 9, PROJECT: 10,
});

export function metadataFailure(state, reason, httpStatus) {
  return { state, itemCount: null, reason,
    ...(httpStatus === undefined ? {} : { httpStatus }) };
}

export function completedMetadataItems(items, orderBy) {
  const ordered = [...items];
  if (orderBy === "id") ordered.sort((left, right) => left.id - right.id);
  else if (orderBy) ordered.sort((left, right) => compareUtf8(left[orderBy], right[orderBy]));
  return ordered.length === 0
    ? { state: "empty", itemCount: 0, items: [] }
    : { state: "ok", itemCount: ordered.length, items: ordered };
}

function parsedFailure(state, reason) { return metadataFailure(state, reason, 200); }

function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function isWellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validString(value, nullable = false) {
  return (nullable && value === null) ||
    (typeof value === "string" && value.length > 0 && isWellFormed(value));
}

function withinStringLimit(value) {
  return value === null || Buffer.byteLength(value, "utf8") <= METADATA_LIMITS.metadataStringBytes;
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
  return uid !== "." && uid !== ".." && !/[\\/?#\s\u0000-\u001f\u007f-\u009f]/u.test(uid);
}

function parsedRows(checkpoint, first, last = first) {
  for (let row = first; row <= last; row += 1) checkpoint();
}

function orderedKeysForRow7(map) {
  const keys = Object.keys(map);
  if (!keys.every(isWellFormed)) return null;
  keys.sort(compareUtf8);
  return keys;
}

function keysSatisfy(keys, checkpoint, predicate) {
  for (const key of keys) {
    checkpoint();
    if (!predicate(key)) return false;
  }
  return true;
}

function nonEmptyKey(key) { return key.length > 0; }

function apiResult(payload, checkpoint, { expectedVersion }) {
  parsedRows(checkpoint, PARSED_ROW.ENVELOPE);
  if (!isObject(payload) || typeof payload.database !== "string")
    return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.API_STATE);
  if (payload.database !== "ok") return parsedFailure("unavailable", "api_database_not_ok");
  parsedRows(checkpoint, PARSED_ROW.PAGE_LIMIT, PARSED_ROW.SHAPE);
  const hasVersion = Object.hasOwn(payload, "version");
  const version = hasVersion ? payload.version : null;
  if (hasVersion && !validString(version)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.STRING_LIMIT);
  if (!withinStringLimit(version)) return parsedFailure("malformed", "string_limit");
  parsedRows(checkpoint, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return completedMetadataItems([{
    databaseOk: true,
    version,
    versionMatchesExpected: version === null
      ? null
      : version === expectedVersion || version.startsWith(`${expectedVersion}.`),
  }]);
}

function datasourceResult(payload, checkpoint) {
  parsedRows(checkpoint, PARSED_ROW.ENVELOPE);
  if (!Array.isArray(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.API_STATE, PARSED_ROW.ITEM_LIMIT);
  if (payload.length > METADATA_LIMITS.itemsPerCollection) return parsedFailure("unknown", "item_limit");
  parsedRows(checkpoint, PARSED_ROW.DEPTH_LIMIT, PARSED_ROW.SHAPE);
  const seen = new Set();
  for (const item of payload) {
    checkpoint();
    if (!isObject(item) || !validString(item.uid) || !validString(item.name) ||
        !validString(item.type) || !validString(item.access) ||
        typeof item.isDefault !== "boolean" || typeof item.readOnly !== "boolean" ||
        !validDatasourceUid(item.uid) || seen.has(item.uid)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    seen.add(item.uid);
  }
  parsedRows(checkpoint, PARSED_ROW.STRING_LIMIT);
  for (const item of payload) {
    checkpoint();
    if (![item.uid, item.name, item.type, item.access].every(withinStringLimit)) {
      return parsedFailure("malformed", "string_limit");
    }
  }
  parsedRows(checkpoint, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return completedMetadataItems(payload.map(({ uid, name, type, access, isDefault, readOnly }) =>
    ({ uid, name, type, access, isDefault, readOnly })), "uid");
}

function searchPageResult(payload, checkpoint, { expectedType, page, seen }) {
  parsedRows(checkpoint, PARSED_ROW.ENVELOPE);
  if (!Array.isArray(payload) || payload.length > METADATA_LIMITS.pageSize)
    return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.API_STATE, PARSED_ROW.PAGE_LIMIT);
  if (page === METADATA_LIMITS.pagesPerCollection && payload.length === METADATA_LIMITS.pageSize)
    return parsedFailure("unknown", "page_limit");
  parsedRows(checkpoint, PARSED_ROW.ITEM_LIMIT, PARSED_ROW.SHAPE);
  const nextSeen = new Set(seen);
  const items = [];
  for (const item of payload) {
    checkpoint();
    const folderUid = expectedType === "dash-db" && Object.hasOwn(item || {}, "folderUid")
      ? item.folderUid
      : null;
    if (!isObject(item) || item.type !== expectedType || !validString(item.uid) ||
        !validString(item.title) || !validString(folderUid, true) || nextSeen.has(item.uid)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    nextSeen.add(item.uid);
    items.push(expectedType === "dash-db"
      ? { uid: item.uid, title: item.title, folderUid }
      : { uid: item.uid, title: item.title });
  }
  parsedRows(checkpoint, PARSED_ROW.STRING_LIMIT);
  for (const item of items) {
    checkpoint();
    const copied = [item.uid, item.title];
    if (Object.hasOwn(item, "folderUid")) copied.push(item.folderUid);
    if (!copied.every(withinStringLimit)) return parsedFailure("malformed", "string_limit");
  }
  parsedRows(checkpoint, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return { items, seen: nextSeen, complete: payload.length < METADATA_LIMITS.pageSize };
}

function scanRulerItemCount(payload) {
  let count = 0;
  for (const namespace of Object.keys(payload)) {
    const groups = payload[namespace];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (isObject(group) && Array.isArray(group.rules)) count += group.rules.length;
    }
  }
  return count;
}

function scanRulerKeyLimit(payload) {
  let exceeded = Object.keys(payload).length > METADATA_LIMITS.dynamicKeysPerMap;
  for (const namespace of Object.keys(payload)) {
    const groups = payload[namespace];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.rules)) continue;
      for (const entry of group.rules) {
        if (!isObject(entry)) continue;
        for (const map of [entry.labels, entry.annotations]) {
          if (isObject(map) && Object.keys(map).length > METADATA_LIMITS.dynamicKeysPerMap)
            exceeded = true;
        }
      }
    }
  }
  return exceeded;
}

function alertRulesResult(payload, checkpoint) {
  parsedRows(checkpoint, PARSED_ROW.ENVELOPE);
  if (!isObject(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.API_STATE, PARSED_ROW.PAGE_LIMIT);
  parsedRows(checkpoint, PARSED_ROW.ITEM_LIMIT);
  if (scanRulerItemCount(payload) > METADATA_LIMITS.itemsPerCollection)
    return parsedFailure("unknown", "item_limit");
  parsedRows(checkpoint, PARSED_ROW.DEPTH_LIMIT);
  parsedRows(checkpoint, PARSED_ROW.KEY_LIMIT);
  if (scanRulerKeyLimit(payload)) return parsedFailure("unknown", "key_limit");
  parsedRows(checkpoint, PARSED_ROW.SHAPE);
  const namespaces = orderedKeysForRow7(payload);
  if (!namespaces) return parsedFailure("malformed", "invalid_shape");
  const seen = new Set();
  const staged = [];
  for (const namespace of namespaces) {
    checkpoint();
    if (namespace.length === 0) return parsedFailure("malformed", "invalid_shape");
    const groups = payload[namespace];
    if (!Array.isArray(groups)) return parsedFailure("malformed", "invalid_shape");
    for (const group of groups) {
      checkpoint();
      if (!isObject(group) || !Array.isArray(group.rules)) return parsedFailure("malformed", "invalid_shape");
      for (const entry of group.rules) {
        checkpoint();
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
        if (!labelKeys || !annotationKeys || !keysSatisfy(labelKeys, checkpoint, nonEmptyKey) ||
            !keysSatisfy(annotationKeys, checkpoint, nonEmptyKey)) {
          return parsedFailure("malformed", "invalid_shape");
        }
        seen.add(ga.uid);
        staged.push({ ga, labelKeys, annotationKeys });
      }
    }
  }
  parsedRows(checkpoint, PARSED_ROW.STRING_LIMIT);
  if (!keysSatisfy(namespaces, checkpoint, withinStringLimit))
    return parsedFailure("malformed", "string_limit");
  for (const { ga, labelKeys, annotationKeys } of staged) {
    checkpoint();
    const copied = [ga.uid, ga.title, ga.namespace_uid ?? null, ga.rule_group ?? null,
      ga.no_data_state ?? null, ga.exec_err_state ?? null];
    if (!copied.every(withinStringLimit) ||
        !keysSatisfy(labelKeys, checkpoint, withinStringLimit) ||
        !keysSatisfy(annotationKeys, checkpoint, withinStringLimit)) {
      return parsedFailure("malformed", "string_limit");
    }
  }
  parsedRows(checkpoint, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
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
  return completedMetadataItems(items, "uid");
}

function contactPointsResult(payload, checkpoint) {
  parsedRows(checkpoint, PARSED_ROW.ENVELOPE);
  if (!Array.isArray(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.API_STATE, PARSED_ROW.ITEM_LIMIT);
  if (payload.length > METADATA_LIMITS.itemsPerCollection) return parsedFailure("unknown", "item_limit");
  parsedRows(checkpoint, PARSED_ROW.DEPTH_LIMIT, PARSED_ROW.KEY_LIMIT);
  for (const item of payload) {
    checkpoint();
    if (isObject(item?.settings) && Object.keys(item.settings).length > METADATA_LIMITS.dynamicKeysPerMap) {
      return parsedFailure("unknown", "key_limit");
    }
  }
  parsedRows(checkpoint, PARSED_ROW.SHAPE);
  const seen = new Set();
  const staged = [];
  for (const item of payload) {
    checkpoint();
    if (!isObject(item) || !validString(item.uid) || !validString(item.name) ||
        !validString(item.type) || !isObject(item.settings) || seen.has(item.uid) ||
        (Object.hasOwn(item, "disableResolveMessage") && typeof item.disableResolveMessage !== "boolean")) {
      return parsedFailure("malformed", "invalid_shape");
    }
    const settingKeys = orderedKeysForRow7(item.settings);
    if (!settingKeys || !keysSatisfy(settingKeys, checkpoint, nonEmptyKey)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    seen.add(item.uid);
    staged.push({ item, settingKeys });
  }
  parsedRows(checkpoint, PARSED_ROW.STRING_LIMIT);
  for (const { item, settingKeys } of staged) {
    checkpoint();
    if (![item.uid, item.name, item.type].every(withinStringLimit) ||
        !keysSatisfy(settingKeys, checkpoint, withinStringLimit)) {
      return parsedFailure("malformed", "string_limit");
    }
  }
  parsedRows(checkpoint, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return completedMetadataItems(staged.map(({ item, settingKeys }) => ({
    uid: item.uid,
    name: item.name,
    type: item.type,
    disableResolveMessage: item.disableResolveMessage ?? false,
    settingKeys,
  })), "uid");
}

function walkPolicy(root, checkpoint, visitor) {
  const stack = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    checkpoint();
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

function notificationPolicyResult(payload, checkpoint) {
  parsedRows(checkpoint, PARSED_ROW.ENVELOPE);
  if (!isObject(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.API_STATE, PARSED_ROW.ITEM_LIMIT);
  let routeCount = 0;
  if (!walkPolicy(payload, checkpoint, () => (++routeCount <= METADATA_LIMITS.policyRouteNodes))) {
    return parsedFailure("unknown", "item_limit");
  }
  parsedRows(checkpoint, PARSED_ROW.DEPTH_LIMIT);
  let maxDepth = 0;
  if (!walkPolicy(payload, checkpoint, (_, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    return depth <= METADATA_LIMITS.policyDepth;
  })) return parsedFailure("unknown", "depth_limit");
  parsedRows(checkpoint, PARSED_ROW.KEY_LIMIT, PARSED_ROW.SHAPE);
  const receiverNames = new Set();
  const valid = walkPolicy(payload, checkpoint, (node) => {
    if (!isObject(node) || !validString(node.receiver) ||
        (Object.hasOwn(node, "routes") && !Array.isArray(node.routes))) return false;
    receiverNames.add(node.receiver);
    return true;
  });
  if (!valid) return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.STRING_LIMIT);
  if (!walkPolicy(payload, checkpoint, (node) => withinStringLimit(node.receiver))) {
    return parsedFailure("malformed", "string_limit");
  }
  parsedRows(checkpoint, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return completedMetadataItems([{
    rootReceiver: payload.receiver,
    receiverNames: [...receiverNames].sort(compareUtf8),
    routeCount,
    maxDepth,
  }]);
}

function callerPermissionsResult(payload, checkpoint) {
  parsedRows(checkpoint, PARSED_ROW.ENVELOPE);
  if (!isObject(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.API_STATE, PARSED_ROW.KEY_LIMIT);
  if (Object.keys(payload).length > METADATA_LIMITS.dynamicKeysPerMap) {
    return parsedFailure("unknown", "key_limit");
  }
  parsedRows(checkpoint, PARSED_ROW.SHAPE);
  const keys = orderedKeysForRow7(payload);
  if (!keys) return parsedFailure("malformed", "invalid_shape");
  const items = [];
  for (const action of keys) {
    checkpoint();
    if (action.length === 0) return parsedFailure("malformed", "invalid_shape");
    if (!PERMISSIONS.has(action)) continue;
    if (!Array.isArray(payload[action]) || !safeIntegerAtLeast(payload[action].length, 0)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    items.push({ action, scopeCount: payload[action].length });
  }
  parsedRows(checkpoint, PARSED_ROW.STRING_LIMIT);
  if (!keysSatisfy(keys, checkpoint, withinStringLimit)) return parsedFailure("malformed", "string_limit");
  parsedRows(checkpoint, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return completedMetadataItems(items, "action");
}

function serviceAccountsPageResult(payload, checkpoint, state) {
  const { requestedPage, stableTotal, seen, rawCount } = state;
  parsedRows(checkpoint, PARSED_ROW.ENVELOPE);
  if (!isObject(payload) || !Array.isArray(payload.serviceAccounts) ||
      payload.serviceAccounts.length > METADATA_LIMITS.pageSize || payload.page !== requestedPage ||
      payload.perPage !== METADATA_LIMITS.pageSize || !safeIntegerAtLeast(payload.page, 1) ||
      !safeIntegerAtLeast(payload.perPage, 1) || !safeIntegerAtLeast(payload.totalCount, 0) ||
      (stableTotal !== null && payload.totalCount !== stableTotal)) {
    return parsedFailure("malformed", "invalid_shape");
  }
  parsedRows(checkpoint, PARSED_ROW.API_STATE, PARSED_ROW.ITEM_LIMIT);
  if (payload.totalCount > METADATA_LIMITS.itemsPerCollection) return parsedFailure("unknown", "item_limit");
  parsedRows(checkpoint, PARSED_ROW.DEPTH_LIMIT, PARSED_ROW.SHAPE);
  const nextSeen = new Set(seen);
  const items = [];
  for (const account of payload.serviceAccounts) {
    checkpoint();
    if (!isObject(account) || !safeIntegerAtLeast(account.id, 1) || !validString(account.name) ||
        !validString(account.role) || typeof account.isDisabled !== "boolean" ||
        !safeIntegerAtLeast(account.tokens, 0) || nextSeen.has(account.id)) {
      return parsedFailure("malformed", "invalid_shape");
    }
    nextSeen.add(account.id);
    items.push({ id: account.id, name: account.name, role: account.role,
      isDisabled: account.isDisabled, tokenCount: account.tokens });
  }
  const nextRawCount = rawCount + payload.serviceAccounts.length;
  const total = payload.totalCount;
  let transition;
  if (nextRawCount > total || nextSeen.size > total || nextRawCount !== nextSeen.size) transition = "invalid";
  else if (nextRawCount === total) transition = "complete";
  else if (payload.serviceAccounts.length === METADATA_LIMITS.pageSize &&
      requestedPage < METADATA_LIMITS.pagesPerCollection) transition = "continue";
  else transition = "invalid";
  if (transition === "invalid") return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.STRING_LIMIT);
  for (const item of items) {
    checkpoint();
    if (![item.name, item.role].every(withinStringLimit)) return parsedFailure("malformed", "string_limit");
  }
  parsedRows(checkpoint, PARSED_ROW.HEALTH_STATE, PARSED_ROW.PROJECT);
  return { items, seen: nextSeen, total, rawCount: nextRawCount, transition };
}

function datasourceHealthResult(payload, checkpoint) {
  parsedRows(checkpoint, PARSED_ROW.ENVELOPE);
  if (!isObject(payload)) return parsedFailure("malformed", "invalid_shape");
  parsedRows(checkpoint, PARSED_ROW.API_STATE, PARSED_ROW.SHAPE);
  if (typeof payload.status !== "string" || !isWellFormed(payload.status)) {
    return parsedFailure("malformed", "invalid_shape");
  }
  parsedRows(checkpoint, PARSED_ROW.STRING_LIMIT);
  if (!withinStringLimit(payload.status)) return parsedFailure("malformed", "string_limit");
  parsedRows(checkpoint, PARSED_ROW.HEALTH_STATE);
  if (payload.status !== "OK") return parsedFailure("unavailable", "datasource_health_failed");
  parsedRows(checkpoint, PARSED_ROW.PROJECT);
  return { state: "ok" };
}

export const metadataNormalizers = Object.freeze({
  api: apiResult,
  datasources: datasourceResult,
  searchPage: searchPageResult,
  alertRules: alertRulesResult,
  contactPoints: contactPointsResult,
  notificationPolicy: notificationPolicyResult,
  callerPermissions: callerPermissionsResult,
  serviceAccountsPage: serviceAccountsPageResult,
  datasourceHealth: datasourceHealthResult,
});
