import {
  normalizeSessionEventEnvelope,
  type SessionEventEnvelope,
  type SessionRawNotificationEnvelope,
} from "../types/events.js";
import {
  normalizeSession,
  type AnyHarnessEventSupportWindowV1,
  type AnyHarnessRawNotificationSupportWindowV1,
  type AnyHarnessSessionSupportWindowV1,
  type ListSupportEvidenceWindowOptions,
  type ListSupportSessionWindowOptions,
  type Session,
} from "../types/sessions.js";
import type { AnyHarnessRequestOptions } from "./core.js";
import { normalizeOwnQueryParameter } from "./query.js";
import { retainSupportWindowResponseBytes } from "./support-window-response-bytes.js";
import {
  assertSupportWindowRequestSignal,
  normalizeSupportWindowRequestOptions,
} from "./support-window-request.js";
import {
  validateSupportEventItem,
  validateSupportRawNotificationItem,
  validateSupportSessionItem,
} from "./support-window-items.js";
import {
  normalizeSupportWindowTimestamp,
  validateSupportWindowTimeRange,
} from "./support-window-time.js";
const SESSION_RESPONSE_BYTES = 1_048_576;
const EVENT_RESPONSE_BYTES = 4_194_304;
const RAW_NOTIFICATION_RESPONSE_BYTES = 2_097_152;
const MIN_RESPONSE_BYTES = 16_384;
const MAX_NORMALIZATION_DEPTH = 256;
const MAX_NORMALIZED_VALUES = 4_194_304;
const utf8Encoder = new TextEncoder();
interface BoundedJsonTransport {
  getBoundedJson<T>(
    path: string,
    maxResponseBytes: number,
    options?: AnyHarnessRequestOptions,
  ): Promise<{ body: T; bodyBytes: number }>;
}
interface PreparedSupportWindowRequest {
  maxResponseBytes: number;
  itemLimit: number;
  request: AnyHarnessRequestOptions;
  query: string;
}
interface CloneState {
  remainingValues: number;
  seen: WeakSet<object>;
}
export async function listSupportSessionWindow(
  transport: BoundedJsonTransport,
  workspaceId: string,
  options: ListSupportSessionWindowOptions,
): Promise<AnyHarnessSessionSupportWindowV1> {
  assertSupportId(workspaceId, "workspaceId");
  const prepared = prepareSessionWindowRequest(options);
  await assertSupportWindowRequestSignal(prepared.request);
  const response = await transport.getBoundedJson<unknown>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions/support-window?${prepared.query}`,
    prepared.maxResponseBytes,
    prepared.request,
  );
  return retainSupportWindowResponseBytes(
    normalizeSessionWindow(response.body, prepared),
    response.bodyBytes,
    prepared.maxResponseBytes,
  );
}
export async function listSupportEventWindow(
  transport: BoundedJsonTransport,
  sessionId: string,
  options: ListSupportEvidenceWindowOptions,
): Promise<AnyHarnessEventSupportWindowV1> {
  assertSupportId(sessionId, "sessionId");
  const prepared = prepareEvidenceWindowRequest(
    options,
    200,
    EVENT_RESPONSE_BYTES,
  );
  await assertSupportWindowRequestSignal(prepared.request);
  const response = await transport.getBoundedJson<unknown>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/events/support-window?${prepared.query}`,
    prepared.maxResponseBytes,
    prepared.request,
  );
  return retainSupportWindowResponseBytes(
    normalizeEventWindow(response.body, prepared),
    response.bodyBytes,
    prepared.maxResponseBytes,
  );
}
export async function listSupportRawNotificationWindow(
  transport: BoundedJsonTransport,
  sessionId: string,
  options: ListSupportEvidenceWindowOptions,
): Promise<AnyHarnessRawNotificationSupportWindowV1> {
  assertSupportId(sessionId, "sessionId");
  const prepared = prepareEvidenceWindowRequest(
    options,
    100,
    RAW_NOTIFICATION_RESPONSE_BYTES,
  );
  await assertSupportWindowRequestSignal(prepared.request);
  const response = await transport.getBoundedJson<unknown>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/raw-notifications/support-window?${prepared.query}`,
    prepared.maxResponseBytes,
    prepared.request,
  );
  return retainSupportWindowResponseBytes(
    normalizeRawNotificationWindow(response.body, prepared),
    response.bodyBytes,
    prepared.maxResponseBytes,
  );
}
function prepareSessionWindowRequest(
  options: ListSupportSessionWindowOptions,
): PreparedSupportWindowRequest {
  const mode = requiredQueryValue(options, "mode", "string");
  const expectedKeys = mode === "exact"
    ? ["mode", "sessionId", "updatedAtTo", "limit", "maxResponseBytes", "request"]
    : mode === "recent"
      ? ["mode", "updatedAtFrom", "updatedAtTo", "limit", "maxResponseBytes", "request"]
      : null;
  if (!expectedKeys) {
    throw invalidSupportWindowOptions("mode must be exact or recent");
  }
  assertExactOwnDataProperties(options, expectedKeys);
  const updatedAtToValue = requiredQueryValue(options, "updatedAtTo", "string");
  const updatedAtTo = normalizeSupportWindowTimestamp(updatedAtToValue);
  const limit = requiredSafeInteger(options, "limit");
  const maxResponseBytes = requiredSafeInteger(options, "maxResponseBytes");
  if (maxResponseBytes !== SESSION_RESPONSE_BYTES) {
    throw invalidSupportWindowOptions("session maxResponseBytes must be 1048576");
  }
  const params = new URLSearchParams();
  params.set("mode", mode);
  if (mode === "exact") {
    if (limit !== 1) {
      throw invalidSupportWindowOptions("exact session limit must be 1");
    }
    const sessionId = requiredQueryValue(options, "sessionId", "string");
    assertSupportId(sessionId, "sessionId");
    params.set("session_id", sessionId);
  } else {
    if (limit < 1 || limit > 3) {
      throw invalidSupportWindowOptions("recent session limit must be between 1 and 3");
    }
    const updatedAtFrom = requiredQueryValue(options, "updatedAtFrom", "string");
    validateSupportWindowTimeRange(updatedAtFrom, updatedAtToValue);
    params.set("updated_at_from", normalizeSupportWindowTimestamp(updatedAtFrom));
  }
  params.set("updated_at_to", updatedAtTo);
  params.set("limit", String(limit));
  params.set("max_response_bytes", String(maxResponseBytes));
  return {
    maxResponseBytes,
    itemLimit: limit,
    request: normalizeSupportWindowRequestOptions(requiredOwnData(options, "request")),
    query: params.toString(),
  };
}
function prepareEvidenceWindowRequest(
  options: ListSupportEvidenceWindowOptions,
  maxItems: number,
  maxBytes: number,
): PreparedSupportWindowRequest {
  assertExactOwnDataProperties(options, [
    "timestampFrom",
    "timestampTo",
    "limit",
    "maxResponseBytes",
    "request",
  ]);
  const timestampFrom = requiredQueryValue(options, "timestampFrom", "string");
  const timestampTo = requiredQueryValue(options, "timestampTo", "string");
  validateSupportWindowTimeRange(timestampFrom, timestampTo);
  const limit = requiredSafeInteger(options, "limit");
  const maxResponseBytes = requiredSafeInteger(options, "maxResponseBytes");
  if (limit < 1 || limit > maxItems) {
    throw invalidSupportWindowOptions(`limit must be between 1 and ${maxItems}`);
  }
  if (maxResponseBytes < MIN_RESPONSE_BYTES || maxResponseBytes > maxBytes) {
    throw invalidSupportWindowOptions(
      `maxResponseBytes must be between ${MIN_RESPONSE_BYTES} and ${maxBytes}`,
    );
  }

  const params = new URLSearchParams();
  params.set("timestamp_from", normalizeSupportWindowTimestamp(timestampFrom));
  params.set("timestamp_to", normalizeSupportWindowTimestamp(timestampTo));
  params.set("limit", String(limit));
  params.set("max_response_bytes", String(maxResponseBytes));
  return {
    maxResponseBytes,
    itemLimit: limit,
    request: normalizeSupportWindowRequestOptions(requiredOwnData(options, "request")),
    query: params.toString(),
  };
}
function requiredQueryValue(
  input: unknown,
  property: string,
  kind: "string" | "safe-integer",
): string {
  const normalized = normalizeOwnQueryParameter(input, property, kind);
  if (!normalized.present) {
    throw invalidSupportWindowOptions(`${property} is required`);
  }
  return normalized.value;
}

function requiredSafeInteger(input: unknown, property: string): number {
  return Number(requiredQueryValue(input, property, "safe-integer"));
}
function requiredOwnData(input: unknown, property: string): unknown {
  if (!isObjectLike(input)) {
    throw invalidSupportWindowOptions(`${property} must be an own data property`);
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, property);
  } catch {
    throw invalidSupportWindowOptions(`${property} must be an own data property`);
  }
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw invalidSupportWindowOptions(`${property} must be an own data property`);
  }
  return descriptor.value as unknown;
}
function assertExactOwnDataProperties(input: unknown, expected: string[]): void {
  if (!isObjectLike(input) || Array.isArray(input)) {
    throw invalidSupportWindowOptions("options must be an object");
  }
  assertOptionsPrototype(input);
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throw invalidSupportWindowOptions("options properties could not be inspected");
  }
  if (keys.length !== expected.length) {
    throw invalidSupportWindowOptions("options contain missing or incompatible properties");
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string" || !expected.includes(key)) {
      throw invalidSupportWindowOptions("options contain an incompatible property");
    }
    requiredOwnData(input, key);
  }
}

function assertSupportId(value: string, label: string): void {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 128
    || utf8Encoder.encode(value).byteLength > 128
    || /[\p{Cc}\p{White_Space}\uD800-\uDFFF]/u.test(value)
  ) {
    throw invalidSupportWindowOptions(`${label} is invalid`);
  }
}

function assertOptionsPrototype(value: object): void {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw invalidSupportWindowOptions("options prototype could not be inspected");
  }
  if (prototype !== Object.prototype) {
    throw invalidSupportWindowOptions("options must have the ordinary object prototype");
  }
}

function normalizeSessionWindow(
  value: unknown,
  expected: PreparedSupportWindowRequest,
): AnyHarnessSessionSupportWindowV1 {
  const envelope = normalizeEnvelope(value, expected, "updated_desc_id_asc");
  const items = new Array<Session>(envelope.items.length);
  for (let index = 0; index < envelope.items.length; index += 1) {
    items[index] = normalizeSession(validateSupportSessionItem(
      requireDataObject(envelope.items[index], "session item"),
    ));
  }
  return { window: envelope.window, items } as AnyHarnessSessionSupportWindowV1;
}

function normalizeEventWindow(
  value: unknown,
  expected: PreparedSupportWindowRequest,
): AnyHarnessEventSupportWindowV1 {
  const envelope = normalizeEnvelope(value, expected, "seq_asc");
  const items = new Array<SessionEventEnvelope>(envelope.items.length);
  for (let index = 0; index < envelope.items.length; index += 1) {
    items[index] = normalizeSessionEventEnvelope(validateSupportEventItem(
      requireDataObject(envelope.items[index], "event item"),
    ));
  }
  return { window: envelope.window, items } as AnyHarnessEventSupportWindowV1;
}

function normalizeRawNotificationWindow(
  value: unknown,
  expected: PreparedSupportWindowRequest,
): AnyHarnessRawNotificationSupportWindowV1 {
  const envelope = normalizeEnvelope(value, expected, "seq_asc");
  const items = new Array<SessionRawNotificationEnvelope>(envelope.items.length);
  for (let index = 0; index < envelope.items.length; index += 1) {
    items[index] = validateSupportRawNotificationItem(requireDataObject(
      envelope.items[index],
      "raw notification item",
    ));
  }
  return { window: envelope.window, items } as AnyHarnessRawNotificationSupportWindowV1;
}

function normalizeEnvelope(
  value: unknown,
  expected: PreparedSupportWindowRequest,
  presentationOrder: "updated_desc_id_asc" | "seq_asc",
): { window: Record<string, unknown>; items: unknown[] } {
  const cloned = cloneJsonData(value);
  const envelope = requireDataObject(cloned, "support-window envelope");
  assertSafeObjectKeys(envelope, ["window", "items"], "support-window envelope");
  const window = requireDataObject(envelope.window, "support-window metadata");
  assertSafeObjectKeys(window, [
    "schemaVersion",
    "selection",
    "presentationOrder",
    "itemLimit",
    "responseByteLimit",
    "returnedItems",
    "omittedOversizedItems",
    "completeness",
  ], "support-window metadata");
  const items = requireSafeArray(envelope.items, "support-window items");
  if (
    !isNonNegativeSafeInteger(window.schemaVersion)
    || window.schemaVersion !== 1
    || window.selection !== "newest_matching"
    || window.presentationOrder !== presentationOrder
    || !isNonNegativeSafeInteger(window.itemLimit)
    || window.itemLimit !== expected.itemLimit
    || !isNonNegativeSafeInteger(window.responseByteLimit)
    || window.responseByteLimit !== expected.maxResponseBytes
    || !isNonNegativeSafeInteger(window.returnedItems)
    || window.returnedItems !== items.length
    || items.length > expected.itemLimit
    || !isNonNegativeSafeInteger(window.omittedOversizedItems)
    || (window.completeness !== "complete" && window.completeness !== "limit_uncertain")
    || (window.completeness === "complete" && window.omittedOversizedItems !== 0)
  ) {
    throw invalidSupportWindowResponse("support-window metadata is inconsistent");
  }
  return { window, items };
}

function cloneJsonData(value: unknown): unknown {
  return cloneJsonValue(value, 0, {
    remainingValues: MAX_NORMALIZED_VALUES,
    seen: new WeakSet<object>(),
  });
}

function cloneJsonValue(value: unknown, depth: number, state: CloneState): unknown {
  consumeCloneBudget(state, 1);
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalidSupportWindowResponse("response contains a non-JSON number");
    }
    return value;
  }
  if (!isObjectLike(value) || depth >= MAX_NORMALIZATION_DEPTH) {
    throw invalidSupportWindowResponse("response contains an unsupported value");
  }
  if (state.seen.has(value)) {
    throw invalidSupportWindowResponse("response contains a cycle");
  }
  state.seen.add(value);
  try {
    let arrayValue = false;
    try {
      arrayValue = Array.isArray(value);
    } catch {
      throw invalidSupportWindowResponse("response array could not be inspected");
    }
    return arrayValue
      ? cloneJsonArray(value, depth, state)
      : cloneJsonObject(value, depth, state);
  } finally {
    state.seen.delete(value);
  }
}

function cloneJsonArray(value: object, depth: number, state: CloneState): unknown[] {
  assertExactPrototype(value, Array.prototype, "response array");
  const length = ownDescriptor(value, "length", "response array").value;
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw invalidSupportWindowResponse("response array length is invalid");
  }
  const keys = responseOwnKeys(value, "response array");
  if (keys.length !== (length as number) + 1 || keys[keys.length - 1] !== "length") {
    throw invalidSupportWindowResponse("response array has incompatible properties");
  }
  const output = new Array<unknown>(length as number);
  for (let index = 0; index < (length as number); index += 1) {
    if (keys[index] !== String(index)) {
      throw invalidSupportWindowResponse("response array is sparse or has extra properties");
    }
    const descriptor = ownDescriptor(value, String(index), "response array item");
    if (!descriptor.enumerable) {
      throw invalidSupportWindowResponse("response array item is hidden");
    }
    output[index] = cloneJsonValue(descriptor.value, depth + 1, state);
  }
  return output;
}

function cloneJsonObject(
  value: object,
  depth: number,
  state: CloneState,
): Record<string, unknown> {
  assertExactPrototype(value, Object.prototype, "response object");
  const keys = responseOwnKeys(value, "response object");
  const output: Record<string, unknown> = {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") {
      throw invalidSupportWindowResponse("response object contains a symbol property");
    }
    const descriptor = ownDescriptor(value, key, "response object property");
    if (!descriptor.enumerable) {
      throw invalidSupportWindowResponse("response object contains a hidden property");
    }
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: cloneJsonValue(descriptor.value, depth + 1, state),
      writable: true,
    });
  }
  return output;
}

function assertExactPrototype(value: object, expected: object, label: string): void {
  // Bounded bodies are parsed by JSON.parse in this SDK realm. Requiring its
  // exact JSON prototypes deliberately rejects caller-injected foreign-realm
  // objects along with altered, null, and custom prototypes.
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw invalidSupportWindowResponse(`${label} prototype could not be inspected`);
  }
  if (prototype !== expected) {
    throw invalidSupportWindowResponse(`${label} has an incompatible prototype`);
  }
}

function responseOwnKeys(value: object, label: string): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw invalidSupportWindowResponse(`${label} could not be inspected`);
  }
}

function ownDescriptor(
  value: object,
  property: string,
  label: string,
): PropertyDescriptor & { value: unknown } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, property);
  } catch {
    throw invalidSupportWindowResponse(`${label} could not be inspected`);
  }
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw invalidSupportWindowResponse(`${label} must be an own data property`);
  }
  return descriptor as PropertyDescriptor & { value: unknown };
}

function consumeCloneBudget(state: CloneState, amount: number): void {
  if (amount > state.remainingValues) {
    throw invalidSupportWindowResponse("response normalization budget was exceeded");
  }
  state.remainingValues -= amount;
}

function requireDataObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObjectLike(value) || Array.isArray(value)) {
    throw invalidSupportWindowResponse(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireSafeArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidSupportWindowResponse(`${label} must be an array`);
  }
  return value;
}

function assertSafeObjectKeys(
  value: Record<string, unknown>,
  expected: string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) {
    throw invalidSupportWindowResponse(`${label} has incompatible fields`);
  }
  for (let index = 0; index < keys.length; index += 1) {
    if (!expected.includes(keys[index])) {
      throw invalidSupportWindowResponse(`${label} has an incompatible field`);
    }
  }
}

function isNonNegativeSafeInteger(value: unknown): boolean {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function invalidSupportWindowOptions(message: string): TypeError {
  return new TypeError(`Invalid support-window options: ${message}`);
}

function invalidSupportWindowResponse(message: string): TypeError {
  return new TypeError(`Invalid support-window response: ${message}`);
}
