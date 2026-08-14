import type { RejectionReasonV1 } from "./contract";
import {
  MAX_ID_BYTES,
  MAX_NAME_BYTES,
  MAX_SAFE_INTEGER,
} from "./limits";

export type JsonObject = Record<string, unknown>;

export class DiagnosticsContractErrorV1 extends Error {
  readonly reason: RejectionReasonV1;

  constructor(reason: RejectionReasonV1) {
    super(reason);
    this.name = "DiagnosticsContractErrorV1";
    this.reason = reason;
  }
}

export function requireObject(input: unknown): JsonObject {
  if (!isObject(input)) {
    fail("invalid_shape");
  }
  return input;
}

export function isObject(input: unknown): input is JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function requireArray(input: unknown): unknown[] {
  if (!Array.isArray(input)) {
    fail("invalid_shape");
  }
  return input;
}

export function requireString(input: unknown): string {
  if (typeof input !== "string") {
    fail("invalid_shape");
  }
  return input;
}

export function requireBoundedString(input: unknown, limit: number): string {
  const value = requireString(input);
  if (value.length === 0) {
    fail("invalid_shape");
  }
  if (utf8ByteLength(value) > limit) {
    fail("limit_exceeded");
  }
  return value;
}

export function requireName(input: unknown): string {
  const value = requireBoundedString(input, MAX_NAME_BYTES);
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(value)) {
    fail("invalid_shape");
  }
  return value;
}

export function optionalName(input: unknown): string | undefined {
  return input === undefined || input === null ? undefined : requireName(input);
}

export function requireId(input: unknown): string {
  return requireBoundedString(input, MAX_ID_BYTES);
}

export function optionalId(input: unknown): string | undefined {
  return input === undefined || input === null ? undefined : requireId(input);
}

export function requireShortString(input: unknown): string {
  return requireBoundedString(input, MAX_NAME_BYTES);
}

export function requireTimestamp(input: unknown): string {
  const value = requireString(input);
  if (
    value.length < 20 ||
    value.length > 35 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    fail("invalid_shape");
  }
  return value;
}

export function requireBoolean(input: unknown): boolean {
  if (typeof input !== "boolean") {
    fail("invalid_shape");
  }
  return input;
}

export function requireFiniteNumber(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    fail("invalid_shape");
  }
  return input;
}

export function requireInteger(input: unknown): number {
  const value = requireFiniteNumber(input);
  if (!Number.isInteger(value)) {
    fail("invalid_shape");
  }
  if (Math.abs(value) > MAX_SAFE_INTEGER) {
    fail("limit_exceeded");
  }
  return value;
}

export function requireNonnegativeInteger(input: unknown): number {
  const value = requireInteger(input);
  if (value < 0) {
    fail("invalid_shape");
  }
  return value;
}

export function requirePositiveInteger(input: unknown): number {
  const value = requireNonnegativeInteger(input);
  if (value === 0) {
    fail("invalid_shape");
  }
  return value;
}

export function optionalNonnegativeInteger(input: unknown): number | undefined {
  return input === undefined || input === null
    ? undefined
    : requireNonnegativeInteger(input);
}

export function requireEnum<T extends string>(input: unknown, values: Set<T>): T {
  const value = requireString(input);
  if (!values.has(value as T)) {
    fail("invalid_shape");
  }
  return value as T;
}

export function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        fail("invalid_shape");
      }
      bytes += 4;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail("invalid_shape");
    }
    bytes += codeUnit <= 0x7f ? 1 : codeUnit <= 0x7ff ? 2 : 3;
  }
  return bytes;
}

export function canonicalClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function fail(reason: RejectionReasonV1): never {
  throw new DiagnosticsContractErrorV1(reason);
}
