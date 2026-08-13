import type { AnyHarnessRequestOptions } from "./core.js";
import { isNativeAbortSignal } from "./abort-signal.js";

const ALLOWED_REQUEST_PROPERTIES = [
  "headers",
  "signal",
  "measurementOperationId",
  "timingCategory",
  "timingScope",
  "timingLifecycle",
];
const headersForEach = Headers.prototype.forEach;
const headersAppend = Headers.prototype.append;

export function normalizeSupportWindowRequestOptions(
  value: unknown,
): AnyHarnessRequestOptions {
  if (!isObjectLike(value) || Array.isArray(value)) {
    throw invalidRequest("request must be an object");
  }
  assertOrdinaryObject(value, "request");
  const keys = ownKeys(value, "request");
  const normalized: AnyHarnessRequestOptions = {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string" || !ALLOWED_REQUEST_PROPERTIES.includes(key)) {
      throw invalidRequest("request contains an incompatible property");
    }
    assignRequestOption(normalized, key, ownData(value, key, "request"));
  }
  return normalized;
}

export async function assertSupportWindowRequestSignal(
  request: AnyHarnessRequestOptions,
): Promise<void> {
  if (
    request.signal !== undefined
    && !(await isNativeAbortSignal(request.signal))
  ) {
    throw invalidRequest("signal must be a local native AbortSignal");
  }
}

function assignRequestOption(
  output: AnyHarnessRequestOptions,
  key: string,
  value: unknown,
): void {
  switch (key) {
    case "headers":
      output.headers = normalizeHeaders(value);
      return;
    case "signal":
      // The platform detector is asynchronous; the owning support-window
      // method validates this captured data value before calling transport.
      output.signal = value as AbortSignal | undefined;
      return;
    case "measurementOperationId":
      if (
        value !== undefined
        && (typeof value !== "string" || !value.startsWith("mop_"))
      ) {
        throw invalidRequest("measurementOperationId must use the mop_ prefix");
      }
      output.measurementOperationId = value as AnyHarnessRequestOptions["measurementOperationId"];
      return;
    case "timingCategory":
      if (value !== undefined && typeof value !== "string") {
        throw invalidRequest("timingCategory must be a string");
      }
      output.timingCategory = value as AnyHarnessRequestOptions["timingCategory"];
      return;
    case "timingScope":
      output.timingScope = normalizeTimingScope(value);
      return;
    case "timingLifecycle":
      output.timingLifecycle = normalizeTimingLifecycle(value);
  }
}

function normalizeHeaders(value: unknown): Headers | undefined {
  if (value === undefined) {
    return undefined;
  }
  const output = new Headers();
  try {
    Reflect.apply(headersForEach, value, [
      (headerValue: string, headerName: string) => {
        Reflect.apply(headersAppend, output, [headerName, headerValue]);
      },
    ]);
    return output;
  } catch {
    // Non-Headers inputs are normalized below without invoking iteration or
    // accessors on caller-owned objects.
  }
  if (!isObjectLike(value)) {
    throw invalidRequest("headers must be valid HeadersInit");
  }
  let arrayValue: boolean;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    throw invalidRequest("headers could not be inspected");
  }
  if (arrayValue) {
    assertDenseArray(value, "headers");
    normalizeHeaderPairs(value, output);
  } else {
    assertOrdinaryObject(value, "headers");
    normalizeHeaderRecord(value, output);
  }
  return output;
}

function normalizeHeaderPairs(value: object, output: Headers): void {
  const length = ownData(value, "length", "headers");
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw invalidRequest("headers array length is invalid");
  }
  for (let index = 0; index < (length as number); index += 1) {
    const pair = ownData(value, String(index), "headers");
    if (!isObjectLike(pair) || !Array.isArray(pair)) {
      throw invalidRequest("headers entries must be pairs");
    }
    assertDenseArray(pair, "headers entry");
    const pairLength = ownData(pair, "length", "headers entry");
    if (pairLength !== 2) {
      throw invalidRequest("headers entries must contain two values");
    }
    appendHeader(
      output,
      ownData(pair, "0", "headers entry"),
      ownData(pair, "1", "headers entry"),
    );
  }
}

function normalizeHeaderRecord(value: object, output: Headers): void {
  const keys = ownKeys(value, "headers");
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") {
      throw invalidRequest("headers contain a symbol property");
    }
    appendHeader(output, key, ownData(value, key, "headers"));
  }
}

function appendHeader(output: Headers, name: unknown, value: unknown): void {
  if (typeof name !== "string" || typeof value !== "string") {
    throw invalidRequest("header names and values must be strings");
  }
  try {
    Reflect.apply(headersAppend, output, [name, value]);
  } catch {
    throw invalidRequest("headers must be valid HeadersInit");
  }
}

function normalizeTimingScope(
  value: unknown,
): AnyHarnessRequestOptions["timingScope"] {
  if (value === undefined) {
    return undefined;
  }
  if (!isObjectLike(value) || Array.isArray(value)) {
    throw invalidRequest("timingScope must be an object");
  }
  assertOrdinaryObject(value, "timingScope");
  const keys = ownKeys(value, "timingScope");
  if (keys.length > 1 || (keys.length === 1 && keys[0] !== "runtimeUrlHash")) {
    throw invalidRequest("timingScope contains an incompatible property");
  }
  if (keys.length === 0) {
    return {};
  }
  const runtimeUrlHash = ownData(value, "runtimeUrlHash", "timingScope");
  if (runtimeUrlHash !== undefined && typeof runtimeUrlHash !== "string") {
    throw invalidRequest("timingScope.runtimeUrlHash must be a string");
  }
  return { runtimeUrlHash };
}

function normalizeTimingLifecycle(
  value: unknown,
): AnyHarnessRequestOptions["timingLifecycle"] {
  if (value === undefined) {
    return undefined;
  }
  if (!isObjectLike(value) || Array.isArray(value)) {
    throw invalidRequest("timingLifecycle must be an object");
  }
  assertOrdinaryObject(value, "timingLifecycle");
  const keys = ownKeys(value, "timingLifecycle");
  if (keys.length > 1 || (keys.length === 1 && keys[0] !== "onRequestStart")) {
    throw invalidRequest("timingLifecycle contains an incompatible property");
  }
  if (keys.length === 0) {
    return {};
  }
  const onRequestStart = ownData(value, "onRequestStart", "timingLifecycle");
  if (onRequestStart !== undefined && typeof onRequestStart !== "function") {
    throw invalidRequest("timingLifecycle.onRequestStart must be a function");
  }
  return { onRequestStart: onRequestStart as NonNullable<
    AnyHarnessRequestOptions["timingLifecycle"]
  >["onRequestStart"] };
}

function ownData(value: object, property: string, label: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, property);
  } catch {
    throw invalidRequest(`${label} could not be inspected`);
  }
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw invalidRequest(`${label}.${property} must be an own data property`);
  }
  return descriptor.value as unknown;
}

function ownKeys(value: object, label: string): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw invalidRequest(`${label} could not be inspected`);
  }
}

function assertOrdinaryObject(value: object, label: string): void {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw invalidRequest(`${label} prototype could not be inspected`);
  }
  if (prototype !== Object.prototype) {
    throw invalidRequest(`${label} must have the ordinary object prototype`);
  }
}

function assertDenseArray(value: object, label: string): void {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw invalidRequest(`${label} prototype could not be inspected`);
  }
  if (prototype !== Array.prototype) {
    throw invalidRequest(`${label} must have the ordinary array prototype`);
  }
  const length = ownData(value, "length", label);
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw invalidRequest(`${label} length is invalid`);
  }
  const keys = ownKeys(value, label);
  if (keys.length !== (length as number) + 1 || keys[keys.length - 1] !== "length") {
    throw invalidRequest(`${label} is sparse or has extra properties`);
  }
  for (let index = 0; index < (length as number); index += 1) {
    if (keys[index] !== String(index)) {
      throw invalidRequest(`${label} is sparse or has extra properties`);
    }
  }
}

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function invalidRequest(message: string): TypeError {
  return new TypeError(`Invalid support-window options: ${message}`);
}
