/**
 * RFC 8785 (JCS) canonical JSON + SHA-256 content hashing (WS1 contract spine,
 * float fix WS1-follow-up).
 *
 * Produces byte-identical output to the Python implementation in
 * `server/.../workflows/contracts/canonical.py`. The JCS subset the workflow
 * contracts use: objects, arrays, strings, booleans, null, and numbers (finite
 * integers and finite non-integer floats). NaN/Infinity remain rejected — RFC
 * 8785 has no representation for them.
 *
 * Number serialization (RFC 8785 §3.2.2.3) is exactly the ECMAScript
 * `Number::toString` algorithm — which is precisely what JS's own `String()`
 * (equivalently `` `${value}` ``) computes for a finite number, including the
 * `-0 -> "0"` special case. So unlike the Python leg (which has to correct
 * `repr(float)`'s different placement rules to match ES), the TS leg gets RFC
 * 8785-correct float formatting for free — it only needs the NaN/Infinity
 * guard and to stop rejecting non-integer floats.
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
    // ES `String()` on a finite number IS the ECMA-262 `Number::toString`
    // algorithm RFC 8785 §3.2.2.3 mandates — including `-0 -> "0"`. No
    // reimplementation needed (contrast the Python leg's `repr()` correction).
    return String(value);
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
