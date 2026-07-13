/**
 * Proves the consumer-facing guarantee of contracts/hashing.ts against real
 * manifest shapes: two semantically identical manifests hash identically
 * regardless of key order, and any value mutation changes the hash. The
 * hashing implementation itself is a frozen contract — this only exercises
 * it, never redefines it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalManifestHash, canonicalJson } from "../contracts/hashing.js";
import { slotValue, validCandidateManifest } from "./test-fixtures.js";

function reorderKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reorderKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, reorderKeysDeep(v)] as const);
    // Reverse insertion order — a different key order than the original, but
    // the same semantic content.
    return Object.fromEntries(entries.reverse());
  }
  return value;
}

test("canonical hash is stable under key reordering", () => {
  const manifest = validCandidateManifest();
  const reordered = reorderKeysDeep(manifest) as typeof manifest;
  assert.equal(canonicalManifestHash(manifest), canonicalManifestHash(reordered));
  assert.equal(canonicalJson(manifest), canonicalJson(reordered));
});

test("canonical hash changes when any value mutates", () => {
  const manifest = validCandidateManifest();
  const original = canonicalManifestHash(manifest);

  const mutatedSha = { ...manifest, sourceSha: "0000000000000000000000000000000000000000" };
  assert.notEqual(canonicalManifestHash(mutatedSha), original);

  const value = slotValue(manifest.webBuild);
  const mutatedNested = {
    ...manifest,
    webBuild: { available: true, value: { ...value, sizeBytes: (value.sizeBytes ?? 0) + 1 } },
  };
  assert.notEqual(canonicalManifestHash(mutatedNested), original);
  assert.notEqual(canonicalManifestHash(mutatedNested), canonicalManifestHash(mutatedSha));
});

test("two structurally distinct manifests never collide", () => {
  const a = validCandidateManifest();
  const b = { ...validCandidateManifest(), sourceSha: "1111111111111111111111111111111111111111" };
  assert.notEqual(canonicalManifestHash(a), canonicalManifestHash(b));
});
