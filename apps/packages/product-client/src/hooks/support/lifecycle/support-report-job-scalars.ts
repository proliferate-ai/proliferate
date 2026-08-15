export const MAX_ID_BYTES = 128;
export const MAX_PATH_BYTES = 4_096;
export const MAX_MESSAGE_CHARACTERS = 5_000;
export const MAX_CREDIT_NAME_CHARACTERS = 200;
export const MAX_ATTACHMENTS = 20;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENT_BASE64_BYTES = 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3);
export const MAX_DIAGNOSTICS_BYTES = 25 * 1024 * 1024;
export const SHA256 = /^[0-9a-f]{64}$/;
export const ARTIFACT_ID = /^ssv1_[0-9a-f]{64}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) invalid(label);
  return value as Record<string, unknown>;
}

export function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = record(value, "record");
  exactKeys(result, keys);
  return result;
}

export function allowedRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): Record<string, unknown> {
  const result = record(value, "record");
  const keys = Object.keys(result);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(result, key))
    || keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid("keys");
  return result;
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) invalid("keys");
}

export function array(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum) invalid(label);
  return value;
}

export function stringArray(value: unknown, maximum: number, bytes: number, label: string): void {
  for (const item of array(value, maximum, label)) boundedString(item, 1, bytes, label);
}

export function boundedString(
  value: unknown,
  minimum: number,
  maximumBytes: number,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.length < minimum
    || new TextEncoder().encode(value).byteLength > maximumBytes) invalid(label);
}

export function boundedCharacters(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): asserts value is string {
  if (typeof value !== "string") invalid(label);
  let length = 0;
  for (const _character of value) length += 1;
  if (length < minimum || length > maximum) invalid(label);
}

export function optionalBoundedString(value: unknown, maximum: number, label: string): void {
  if (value !== undefined) boundedString(value, 0, maximum, label);
}

export function optionalNullableCharacters(value: unknown, maximum: number, label: string): void {
  if (value !== undefined && value !== null) boundedCharacters(value, 0, maximum, label);
}

export function optionalNullableBoundedString(value: unknown, maximum: number, label: string): void {
  if (value !== undefined && value !== null) boundedString(value, 0, maximum, label);
}

export function boolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") invalid(label);
}

export function optionalBoolean(value: unknown, label: string): void {
  if (value !== undefined) boolean(value, label);
}

export function safeInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
    || value > maximum || Object.is(value, -0)) invalid(label);
}

export function timestamp(value: unknown, label: string): asserts value is string {
  boundedString(value, 1, 64, label);
  if (!Number.isFinite(Date.parse(value))) invalid(label);
}

export function optionalTimestamp(value: unknown, label: string): void {
  if (value !== undefined) timestamp(value, label);
}

export function nullableTimestamp(value: unknown, label: string): void {
  if (value !== null) timestamp(value, label);
}

export function nullableBoundedString(value: unknown, maximum: number, label: string): void {
  if (value !== null) boundedString(value, 0, maximum, label);
}

export function nullableFailureKind(value: unknown, label: string): void {
  if (value !== null) boundedString(value, 1, 128, label);
}

export function oneOf(value: unknown, values: readonly string[], label: string): void {
  if (typeof value !== "string" || !values.includes(value)) invalid(label);
}

export function invalid(label: string): never {
  throw new Error(`Invalid persisted support report ${label}.`);
}
