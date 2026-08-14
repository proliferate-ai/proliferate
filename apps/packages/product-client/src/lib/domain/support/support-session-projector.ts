import {
  isSupportIdentity,
  type SupportProjectedJson,
} from "#product/lib/domain/support/support-session-contract";

const MAX_DEPTH = 16;
const MAX_CONTAINER_ITEMS = 256;
const MAX_VALUES_PER_SESSION = 10_000;
const MAX_ID_OR_NAME_BYTES = 128;
const MAX_GENERIC_STRING_BYTES = 4_096;
const MAX_CONTENT_STRING_BYTES = 16_384;
const CONTENT_FIELD_PARTS = [
  "content", "prompt", "transcript", "message", "text", "body", "response", "request",
  "input", "output", "stdout", "stderr", "terminal", "tool", "file", "path", "url",
  "provider", "error",
] as const;

export interface SupportProjectionBudget {
  copiedValues: number;
}

export type SupportProjectionResult =
  | { state: "projected"; value: SupportProjectedJson }
  | { state: "invalid" };

export function createSupportProjectionBudget(): SupportProjectionBudget {
  return { copiedValues: 0 };
}

export function restoreSupportProjectionBudget(
  budget: SupportProjectionBudget,
  copiedValues: number,
): void {
  budget.copiedValues = copiedValues;
}

/**
 * Copies an untrusted SDK value without reading through ordinary property
 * access, invoking iteration, traversing prototypes, or honoring `toJSON`.
 * Any descriptor/proxy trap closes the whole endpoint projection.
 */
export function projectSupportSessionValue(
  input: unknown,
  budget: SupportProjectionBudget,
): SupportProjectionResult {
  const initialCount = budget.copiedValues;
  try {
    const ancestors = new WeakSet<object>();
    const value = projectValue(input, budget, ancestors, 0, null);
    return { state: "projected", value };
  } catch {
    budget.copiedValues = initialCount;
    return { state: "invalid" };
  }
}

export function projectSupportSessionSummaryValue(
  input: unknown,
  budget: SupportProjectionBudget,
): SupportProjectionResult {
  const initialCount = budget.copiedValues;
  try {
    const ancestors = new WeakSet<object>();
    const value = projectValue(input, budget, ancestors, 0, null, new Set(["liveConfig"]));
    return { state: "projected", value };
  } catch {
    budget.copiedValues = initialCount;
    return { state: "invalid" };
  }
}

function projectValue(
  input: unknown,
  budget: SupportProjectionBudget,
  ancestors: WeakSet<object>,
  depth: number,
  owningKey: string | null,
  excludedRootKeys?: ReadonlySet<string>,
): SupportProjectedJson {
  if (depth > MAX_DEPTH || budget.copiedValues >= MAX_VALUES_PER_SESSION) {
    throw new ProjectionRejected();
  }
  budget.copiedValues += 1;

  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "number") {
    if (
      !Number.isFinite(input)
      || Object.is(input, -0)
      || (Number.isInteger(input) && (!Number.isSafeInteger(input) || input < 0))
    ) {
      throw new ProjectionRejected();
    }
    return input;
  }
  if (typeof input === "string") return projectString(input, owningKey);
  if (typeof input !== "object") throw new ProjectionRejected();
  let prototype: object | null;
  let symbols: symbol[];
  try {
    prototype = Object.getPrototypeOf(input);
    symbols = Object.getOwnPropertySymbols(input);
  } catch {
    throw new ProjectionRejected();
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(input);
  } catch {
    throw new ProjectionRejected();
  }
  if (
    symbols.length !== 0
    || prototype !== (isArray ? Array.prototype : Object.prototype)
  ) throw new ProjectionRejected();
  if (ancestors.has(input)) throw new ProjectionRejected();
  ancestors.add(input);
  try {
    return isArray
      ? projectArray(input, budget, ancestors, depth, owningKey)
      : projectObject(input, budget, ancestors, depth, excludedRootKeys);
  } finally {
    ancestors.delete(input);
  }
}

function projectArray(
  input: object,
  budget: SupportProjectionBudget,
  ancestors: WeakSet<object>,
  depth: number,
  owningKey: string | null,
): SupportProjectedJson[] {
  const lengthDescriptor = ownDescriptor(input, "length");
  if (
    !lengthDescriptor
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw new ProjectionRejected();
  }
  if (lengthDescriptor.value > MAX_CONTAINER_ITEMS) throw new ProjectionRejected();
  const length = lengthDescriptor.value;
  const ownNames = safeOwnNames(input);
  const indexNames = ownNames.filter((key) => key !== "length").sort((left, right) =>
    Number(left) - Number(right)
  );
  if (
    ownNames.length !== length + 1
    || !ownNames.includes("length")
    || !indexNames.every((key, index) => key === String(index))
  ) {
    throw new ProjectionRejected();
  }
  const output: SupportProjectedJson[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = ownDescriptor(input, String(index));
    if (!descriptor) throw new ProjectionRejected();
    if (!("value" in descriptor) || !descriptor.enumerable) throw new ProjectionRejected();
    output.push(projectValue(descriptor.value, budget, ancestors, depth + 1, owningKey));
  }
  return output;
}

function projectObject(
  input: object,
  budget: SupportProjectionBudget,
  ancestors: WeakSet<object>,
  depth: number,
  excludedRootKeys?: ReadonlySet<string>,
): { [key: string]: SupportProjectedJson } {
  let keys: string[];
  keys = safeOwnNames(input);
  if (keys.length > MAX_CONTAINER_ITEMS) throw new ProjectionRejected();
  keys.sort(compareUnicodeCodePoints);
  const output: { [key: string]: SupportProjectedJson } = {};
  for (const key of keys) {
    if (depth === 0 && excludedRootKeys?.has(key)) continue;
    if (!isWellFormedUnicode(key) || utf8Bytes(key) > MAX_ID_OR_NAME_BYTES) {
      throw new ProjectionRejected();
    }
    const descriptor = ownDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable) throw new ProjectionRejected();
    if (!("value" in descriptor)) throw new ProjectionRejected();
    Object.defineProperty(output, key, {
      value: projectValue(descriptor.value, budget, ancestors, depth + 1, key),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

function ownDescriptor(input: object, key: string): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(input, key);
  } catch {
    throw new ProjectionRejected();
  }
}

function projectString(value: string, owningKey: string | null): string {
  if (!isWellFormedUnicode(value)) throw new ProjectionRejected();
  const kind = classifyStringField(owningKey);
  if (kind === "id") {
    if (!isSupportIdentity(value)) throw new ProjectionRejected();
    return value;
  }
  const limit = kind === "name"
    ? MAX_ID_OR_NAME_BYTES
    : kind === "content"
      ? MAX_CONTENT_STRING_BYTES
      : MAX_GENERIC_STRING_BYTES;
  if (utf8Bytes(value) > limit) throw new ProjectionRejected();
  return value;
}

function classifyStringField(key: string | null): "id" | "name" | "content" | "generic" {
  if (!key) return "generic";
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^(?:id|ids)$/i.test(key) || /(?:Id|ID|Ids|IDs)$/.test(key) || /(?:^|[_-])ids?$/i.test(key)) {
    return "id";
  }
  if (
    /^(?:name|title)$/i.test(key)
    || /(?:Name|Names)$/.test(key)
    || /(?:^|[_-])names?$/i.test(key)
  ) {
    return "name";
  }
  if (CONTENT_FIELD_PARTS.some((part) => normalized.includes(part))) {
    return "content";
  }
  return "generic";
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function safeOwnNames(input: object): string[] {
  try {
    return Object.getOwnPropertyNames(input);
  } catch {
    throw new ProjectionRejected();
  }
}

function isWellFormedUnicode(value: string): boolean {
  if (new TextDecoder().decode(new TextEncoder().encode(value)) !== value) return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Canonical JSON for trusted DTO shells plus already-projected values. */
export function stringifySupportSessionEvidence(input: unknown): string {
  if (input === null || typeof input === "boolean") return String(input);
  if (typeof input === "number") {
    if (
      !Number.isFinite(input)
      || Object.is(input, -0)
      || (Number.isInteger(input) && (!Number.isSafeInteger(input) || input < 0))
    ) {
      throw new ProjectionRejected();
    }
    return JSON.stringify(input);
  }
  if (typeof input === "string") {
    if (!isWellFormedUnicode(input)) throw new ProjectionRejected();
    return JSON.stringify(input);
  }
  let array: boolean;
  try {
    array = Array.isArray(input);
  } catch {
    throw new ProjectionRejected();
  }
  if (array) {
    if (input === null || Object.getPrototypeOf(input) !== Array.prototype) {
      throw new ProjectionRejected();
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (
      !lengthDescriptor
      || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
    ) throw new ProjectionRejected();
    const values: string[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !("value" in descriptor)) throw new ProjectionRejected();
      values.push(stringifySupportSessionEvidence(descriptor.value));
    }
    return `[${values.join(",")}]`;
  }
  if (typeof input !== "object") throw new ProjectionRejected();
  if (Object.getPrototypeOf(input) !== Object.prototype) throw new ProjectionRejected();
  const keys = Object.getOwnPropertyNames(input).sort(compareUnicodeCodePoints);
  return `{${keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor)) throw new ProjectionRejected();
    return `${JSON.stringify(key)}:${stringifySupportSessionEvidence(descriptor.value)}`;
  }).join(",")}}`;
}

export function compareUnicodeCodePoints(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint === undefined || rightPoint === undefined) break;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  if (leftIndex === left.length && rightIndex === right.length) return 0;
  return leftIndex === left.length ? -1 : 1;
}

class ProjectionRejected extends Error {}
