import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { CleanupEntry, CleanupLedger, CleanupState } from "../../contracts/cleanup.js";
import type { WorldContext } from "../../contracts/world.js";
import { WorldReadinessError } from "../../contracts/world.js";
import type { RetainedProductionManifest } from "../../contracts/artifacts.js";

import { DesktopUpgradeWorldProvisioner } from "./provisioner.js";
import { createIsolatedHome, removeIsolatedHome, assertNotRealLibrary } from "./install.js";

class FakeLedger implements CleanupLedger {
  readonly registered: Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError">[] = [];
  private seq = 0;
  async register(
    entry: Omit<CleanupEntry, "sequence" | "state" | "attempts" | "registeredAt" | "updatedAt" | "lastError">,
  ): Promise<number> {
    this.registered.push(entry);
    return ++this.seq;
  }
  async transition(_sequence: number, _state: CleanupState, _error?: string): Promise<void> {}
  async entries(): Promise<readonly CleanupEntry[]> {
    return [];
  }
}

function retained(): RetainedProductionManifest {
  return {
    schemaVersion: 1,
    kind: "retained-production",
    sourceSha: "abc",
    productVersion: "0.3.26",
    qualificationEvidenceRef: "ref",
    desktopApp: { available: false, reason: "not hashed" },
    desktopUpdater: { available: false, reason: "not hashed" },
    desktopUpdaterTrustIdentity: { available: true, value: "6D2DEBE5D4D4282E" },
    bundledAnyharnessVersion: { available: false, reason: "n/a" },
    bundledWorkerVersion: { available: false, reason: "n/a" },
    seedHash: { available: false, reason: "n/a" },
    catalogHash: { available: false, reason: "n/a" },
    registryHash: { available: false, reason: "n/a" },
    e2bTemplate: { available: false, reason: "n/a" },
    templateComponents: { available: false, reason: "n/a" },
    installedAgentPins: { available: false, reason: "n/a" },
  };
}

function ctx(ledger: CleanupLedger, ret: RetainedProductionManifest | null): WorldContext {
  return {
    run: {
      runId: "run-1",
      sourceSha: "abc",
      candidateManifestHash: "h",
      retainedManifestHash: "rh",
      executionHost: "local",
      origin: "local:test",
      createdAt: "2026-07-13T00:00:00Z",
    },
    shard: { runId: "run-1", shardId: "shard-1-of-1", shardIndex: 0, shardCount: 1 },
    candidate: {} as WorldContext["candidate"],
    retained: ret,
    ledger,
    evidence: { append: async () => {}, finalize: async () => {} },
  };
}

test("assertNotRealLibrary refuses a base inside the real user Library", () => {
  const realLib = join(process.env.HOME ?? "/Users/nobody", "Library", "foo");
  assert.throws(() => assertNotRealLibrary(realLib), /real user Library/);
});

test("createIsolatedHome builds an isolated tree outside the real Library and removes it", () => {
  const iso = createIsolatedHome("run-1");
  assert.ok(existsSync(iso.runtimeHome));
  assert.ok(!iso.base.startsWith(join(process.env.HOME ?? "", "Library")));
  removeIsolatedHome(iso);
  assert.ok(!existsSync(iso.base));
});

test("prepare fails readiness (not fabrication) when no retained N-1 app is supplied", { skip: process.platform !== "darwin" }, async () => {
  const ledger = new FakeLedger();
  const p = new DesktopUpgradeWorldProvisioner({ trustChain: "production" });
  await assert.rejects(() => p.prepare(ctx(ledger, retained())), (err: unknown) => {
    assert.ok(err instanceof WorldReadinessError);
    assert.match(err.message, /no locally-cached retained N-1 \.app/);
    return true;
  });
  // The isolated home was registered in the ledger immediately on creation.
  assert.ok(ledger.registered.some((e) => e.resourceType === "isolated-desktop-home"));
  await p.teardown();
});

test("prepare fails readiness when the retained manifest is missing", { skip: process.platform !== "darwin" }, async () => {
  const ledger = new FakeLedger();
  const p = new DesktopUpgradeWorldProvisioner({ trustChain: "production" });
  await assert.rejects(() => p.prepare(ctx(ledger, null)), WorldReadinessError);
});
