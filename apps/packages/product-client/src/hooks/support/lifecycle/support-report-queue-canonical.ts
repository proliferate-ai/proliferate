const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;

export type QueueJsonValue =
  | null
  | boolean
  | string
  | number
  | QueueJsonValue[]
  | { [key: string]: QueueJsonValue };

export type QueueCanonicalFailure =
  | "access_failed"
  | "array_invalid"
  | "cycle"
  | "non_json_value"
  | "non_plain_object"
  | "number_invalid"
  | "property_invalid";

export class QueueCanonicalError extends Error {
  readonly failure: QueueCanonicalFailure;

  constructor(failure: QueueCanonicalFailure) {
    super(`Support queue value is not canonical JSON: ${failure}.`);
    this.name = "QueueCanonicalError";
    this.failure = failure;
  }
}

/**
 * Serialize a JSON value with object keys ordered by Unicode code point.
 *
 * Inspection is descriptor-based so getters are never invoked. Proxies that
 * throw, revoked proxies, cycles, sparse arrays, symbols, functions, bigint,
 * non-plain objects, and every non-safe numeric representation fail closed.
 */
export function canonicalQueueJson(value: unknown): string {
  return serializeCanonical(value, new WeakSet<object>());
}

export async function sha256QueueText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function queueUtf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = left[Symbol.iterator]();
  const rightPoints = right[Symbol.iterator]();
  while (true) {
    const leftNext = leftPoints.next();
    const rightNext = rightPoints.next();
    if (leftNext.done || rightNext.done) {
      if (leftNext.done && rightNext.done) return 0;
      return leftNext.done ? -1 : 1;
    }
    const leftPoint = leftNext.value.codePointAt(0)!;
    const rightPoint = rightNext.value.codePointAt(0)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
}

function serializeCanonical(value: unknown, visiting: WeakSet<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value) || Object.is(value, -0) || Math.abs(value) > SAFE_INTEGER_MAX) {
        throw new QueueCanonicalError("number_invalid");
      }
      return String(value);
    case "object":
      return serializeObject(value, visiting);
    default:
      throw new QueueCanonicalError("non_json_value");
  }
}

function serializeObject(value: object, visiting: WeakSet<object>): string {
  if (visiting.has(value)) throw new QueueCanonicalError("cycle");
  visiting.add(value);
  try {
    let array: boolean;
    try {
      array = Array.isArray(value);
    } catch {
      throw new QueueCanonicalError("access_failed");
    }
    return array
      ? serializeArray(value as unknown[], visiting)
      : serializeRecord(value, visiting);
  } finally {
    visiting.delete(value);
  }
}

function serializeArray(value: unknown[], visiting: WeakSet<object>): string {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new QueueCanonicalError("access_failed");
  }
  if (prototype !== Array.prototype) {
    throw new QueueCanonicalError("array_invalid");
  }
  const descriptors = ownDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    throw new QueueCanonicalError("array_invalid");
  }
  const stringKeys = ownKeys as string[];
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0
    || stringKeys.length !== length + 1 || !stringKeys.includes("length")) {
    throw new QueueCanonicalError("array_invalid");
  }

  const items: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new QueueCanonicalError("array_invalid");
    }
    items.push(serializeCanonical(descriptor.value, visiting));
  }
  return `[${items.join(",")}]`;
}

function serializeRecord(value: object, visiting: WeakSet<object>): string {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new QueueCanonicalError("access_failed");
  }
  if (prototype !== Object.prototype) {
    throw new QueueCanonicalError("non_plain_object");
  }

  const descriptors = ownDescriptors(value);
  // `getOwnPropertyDescriptors` is the one source inspection. Enumerating its
  // trusted snapshot avoids a stateful Proxy changing the key set between two
  // traps and making canonical bytes silently omit or add a property.
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) {
    throw new QueueCanonicalError("property_invalid");
  }
  const stringKeys = (keys as string[]).sort(compareUnicodeCodePoints);
  const entries: string[] = [];
  for (const key of stringKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new QueueCanonicalError("property_invalid");
    }
    entries.push(`${JSON.stringify(key)}:${serializeCanonical(descriptor.value, visiting)}`);
  }
  return `{${entries.join(",")}}`;
}

function ownDescriptors(value: object): Record<string, PropertyDescriptor> {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new QueueCanonicalError("access_failed");
  }
}
