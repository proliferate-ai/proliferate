/**
 * RFC 8785 (JCS) canonical JSON + SHA-256 content hashing (WS1 contract spine).
 *
 * Produces byte-identical output to the Python implementation in
 * `server/.../workflows/contracts/canonical.py`. The JCS subset the workflow
 * contracts use: objects, arrays, strings, booleans, null, and finite integers.
 * A non-integer float is rejected on purpose (no hashed contract surface carries
 * one; permitting platform float formatting would break cross-language byte
 * agreement).
 */

import { sha256Hex, utf8Bytes } from "./hashing";

function canon(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("non-finite number is not canonicalizable");
    }
    if (Number.isInteger(value)) {
      return String(value);
    }
    throw new Error("non-integer float is not permitted in canonical contract content");
  }
  if (Array.isArray(value)) {
    return `[${value.map(canon).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`).join(",")}}`;
  }
  throw new Error(`unsupported type in canonical JSON: ${typeof value}`);
}

export function canonicalize(value: unknown): string {
  return canon(value);
}

export function contentHash(value: unknown): string {
  return `sha256:${sha256Hex(utf8Bytes(canonicalize(value)))}`;
}

export function hashExcluding(obj: Record<string, unknown>, field: string): string {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key !== field) {
      rest[key] = obj[key];
    }
  }
  return contentHash(rest);
}
