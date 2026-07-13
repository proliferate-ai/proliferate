/**
 * Minimal valid manifest fixtures shared by the artifact-loader tests. Kept
 * in one place so a contract-shape change breaks every dependent test the
 * same way, per the tier-1 "contract fixtures" convention.
 */

import type { CandidateManifest, RetainedProductionManifest, Slot } from "../contracts/artifacts.js";

const DIGEST_64 = "a".repeat(64);
const HASH_32 = "b".repeat(32);

function locator(suffix: string) {
  return {
    locator: `s3://proliferate-artifacts/candidate/9f2c1e7/${suffix}`,
    digest: DIGEST_64,
    algorithm: "sha256" as const,
    sizeBytes: 1024,
  };
}

export function validCandidateManifest(): CandidateManifest {
  return {
    schemaVersion: 1,
    kind: "candidate",
    sourceSha: "9f2c1e7abc1234567890abcdef1234567890abcd",
    sourceContentHash: HASH_32,
    serverImage: { available: true, value: locator("server-image") },
    webBuild: { available: true, value: locator("web-build") },
    desktopApp: { available: false, reason: "not built for this platform yet" },
    desktopUpdater: {
      available: true,
      value: { ...locator("desktop-updater.tar.gz"), signature: "ed25519:deadbeef" },
    },
    anyharness: {
      "darwin-aarch64": { available: true, value: locator("anyharness-darwin-aarch64") },
    },
    worker: {
      "linux-x86_64": { available: true, value: locator("worker-linux-x86_64") },
    },
    supervisor: {
      "linux-x86_64": { available: true, value: locator("supervisor-linux-x86_64") },
    },
    catalogHash: { available: true, value: HASH_32 },
    registryHash: { available: true, value: HASH_32 },
    e2bTemplate: { available: true, value: { templateId: "tmpl_9f2c1e7", inputHash: HASH_32 } },
    selfHostBundle: { available: false, reason: "self-host bundle not produced in this run" },
    litellm: { available: true, value: { image: locator("litellm-image"), configHash: HASH_32 } },
  };
}

export function validRetainedManifest(): RetainedProductionManifest {
  return {
    schemaVersion: 1,
    kind: "retained-production",
    sourceSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    productVersion: "0.2.15",
    qualificationEvidenceRef: "evidence://release-2026-07-01/run-42",
    desktopApp: { available: true, value: locator("desktop-app-n-1") },
    desktopUpdater: {
      available: true,
      value: { ...locator("desktop-updater-n-1.tar.gz"), signature: "ed25519:cafef00d" },
    },
    desktopUpdaterTrustIdentity: { available: true, value: "fingerprint:1234abcd" },
    bundledAnyharnessVersion: { available: true, value: "1.4.0" },
    bundledWorkerVersion: { available: true, value: "1.4.0" },
    seedHash: { available: true, value: HASH_32 },
    catalogHash: { available: true, value: HASH_32 },
    registryHash: { available: true, value: HASH_32 },
    e2bTemplate: { available: true, value: { templateId: "tmpl_n_minus_1", inputHash: HASH_32 } },
    templateComponents: {
      available: true,
      value: {
        anyharness: locator("anyharness-n-1"),
        worker: locator("worker-n-1"),
        supervisor: locator("supervisor-n-1"),
      },
    },
    installedAgentPins: { available: true, value: { "claude-code": "1.2.3", codex: "0.9.0" } },
  };
}

/** Unwraps an available slot's value in a test, throwing if the fixture wasn't set up as expected. */
export function slotValue<T>(slot: Slot<T>): T {
  if (!slot.available) {
    throw new Error("test fixture: expected an available slot but it was unavailable");
  }
  return slot.value;
}

/** Returns a copy of `manifest` with one slot replaced by an unavailable slot, preserving its literal type. */
export function withUnavailableSlot<M extends object, K extends keyof M>(manifest: M, key: K, reason: string): M {
  return { ...manifest, [key]: { available: false, reason } } as M;
}

