import type {
  MeasuredSupportWindow,
  SupportWindowMetaV1,
} from "#product/lib/domain/support/support-session-contract";

export interface ExpectedSupportWindow {
  presentationOrder: SupportWindowMetaV1["presentationOrder"];
  itemLimit: number;
  responseByteLimit: number;
}

export type DecodedSupportWindow =
  | {
      state: "decoded";
      window: SupportWindowMetaV1;
      items: unknown[];
      responseBytes: number;
    }
  | { state: "invalid"; responseBytes: number | null };

/** Descriptor-only decoding for SDK values that may be hostile proxies. */
export function decodeSupportWindow(
  measured: MeasuredSupportWindow,
  expected: ExpectedSupportWindow,
): DecodedSupportWindow {
  let measuredBytes: number | null = null;
  try {
    const measuredObject = requireNonArrayObject(measured);
    const responseBytes = ownData(measuredObject, "responseBytes");
    if (
      !isSafeNonnegativeInteger(responseBytes)
      || responseBytes > expected.responseByteLimit
      || responseBytes === 0
    ) {
      return { state: "invalid", responseBytes: null };
    }
    measuredBytes = responseBytes;
    if (!hasExactEnumerableDataKeys(measuredObject, ["responseBytes", "value"])) {
      return { state: "invalid", responseBytes };
    }
    const value = ownData(measuredObject, "value");

    const envelope = requireNonArrayObject(value);
    if (!hasExactEnumerableDataKeys(envelope, ["items", "window"])) {
      return { state: "invalid", responseBytes };
    }
    const window = decodeMeta(ownData(envelope, "window"), expected);
    const items = decodeDenseArray(ownData(envelope, "items"), expected.itemLimit);
    if (!window || !items) {
      return { state: "invalid", responseBytes };
    }
    return { state: "decoded", window, items, responseBytes };
  } catch {
    return { state: "invalid", responseBytes: measuredBytes };
  }
}

export function syntheticSupportWindow(
  expected: ExpectedSupportWindow,
): SupportWindowMetaV1 {
  return {
    schemaVersion: 1,
    selection: "newest_matching",
    presentationOrder: expected.presentationOrder,
    itemLimit: expected.itemLimit,
    responseByteLimit: expected.responseByteLimit,
    returnedItems: 0,
    omittedOversizedItems: 0,
    completeness: "complete",
  };
}

function decodeMeta(
  input: unknown,
  expected: ExpectedSupportWindow,
): SupportWindowMetaV1 | null {
  const object = requireNonArrayObject(input);
  if (!hasExactEnumerableDataKeys(object, [
    "completeness",
    "itemLimit",
    "omittedOversizedItems",
    "presentationOrder",
    "responseByteLimit",
    "returnedItems",
    "schemaVersion",
    "selection",
  ])) return null;
  const schemaVersion = ownData(object, "schemaVersion");
  const selection = ownData(object, "selection");
  const presentationOrder = ownData(object, "presentationOrder");
  const itemLimit = ownData(object, "itemLimit");
  const responseByteLimit = ownData(object, "responseByteLimit");
  const returnedItems = ownData(object, "returnedItems");
  const omittedOversizedItems = ownData(object, "omittedOversizedItems");
  const completeness = ownData(object, "completeness");
  if (
    schemaVersion !== 1
    || selection !== "newest_matching"
    || presentationOrder !== expected.presentationOrder
    || itemLimit !== expected.itemLimit
    || responseByteLimit !== expected.responseByteLimit
    || !isSafeNonnegativeInteger(returnedItems)
    || returnedItems > itemLimit
    || !isSafeNonnegativeInteger(omittedOversizedItems)
    || (completeness !== "complete" && completeness !== "limit_uncertain")
    || (completeness === "complete" && omittedOversizedItems !== 0)
  ) {
    return null;
  }
  return {
    schemaVersion,
    selection,
    presentationOrder,
    itemLimit,
    responseByteLimit,
    returnedItems,
    omittedOversizedItems,
    completeness,
  };
}

function decodeDenseArray(input: unknown, itemLimit: number): unknown[] | null {
  let isArray: boolean;
  try {
    isArray = Array.isArray(input);
  } catch {
    return null;
  }
  if (!isArray || input === null) return null;
  try {
    if (Object.getPrototypeOf(input) !== Array.prototype) return null;
    if (Object.getOwnPropertySymbols(input).length !== 0) return null;
  } catch {
    return null;
  }
  const length = ownData(input, "length");
  if (!isSafeNonnegativeInteger(length) || length > itemLimit) return null;
  let ownNames: string[];
  try {
    ownNames = Object.getOwnPropertyNames(input);
  } catch {
    return null;
  }
  const indexNames = ownNames.filter((key) => key !== "length").sort((left, right) =>
    Number(left) - Number(right)
  );
  if (
    ownNames.length !== length + 1
    || !ownNames.includes("length")
    || !indexNames.every((key, index) => key === String(index))
  ) return null;
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = ownDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    output.push(descriptor.value);
  }
  return output;
}

function requireNonArrayObject(input: unknown): object {
  if (input === null || typeof input !== "object") throw new WindowRejected();
  let array: boolean;
  try {
    array = Array.isArray(input);
  } catch {
    throw new WindowRejected();
  }
  if (array) throw new WindowRejected();
  return input;
}

function ownData(input: object, key: string): unknown {
  const descriptor = ownDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) throw new WindowRejected();
  return descriptor.value;
}

function ownDescriptor(input: object, key: string): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(input, key);
  } catch {
    throw new WindowRejected();
  }
}

function isSafeNonnegativeInteger(input: unknown): input is number {
  return typeof input === "number"
    && Number.isSafeInteger(input)
    && input >= 0
    && !Object.is(input, -0);
}

function hasExactEnumerableDataKeys(input: object, expected: string[]): boolean {
  let keys: string[];
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype) return false;
    if (Object.getOwnPropertySymbols(input).length !== 0) return false;
    keys = Object.getOwnPropertyNames(input);
    if (keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
    })) return false;
  } catch {
    return false;
  }
  if (keys.length !== expected.length) return false;
  keys.sort();
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] !== expected[index]) return false;
  }
  return true;
}

class WindowRejected extends Error {}
