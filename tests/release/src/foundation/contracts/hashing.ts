/**
 * Canonical manifest hashing.
 *
 * Two semantically identical manifests always hash identically regardless of
 * key order; any byte-level mutation of a value changes the hash. Malformed
 * manifests are rejected before hashing — a hash of an invalid manifest must
 * never exist.
 */

import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (value === undefined) throw new Error("undefined is not representable in a canonical manifest");
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("non-finite numbers are not representable in a canonical manifest");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

export function canonicalManifestHash(manifest: object): string {
  return createHash("sha256").update(canonicalJson(manifest), "utf8").digest("hex");
}
