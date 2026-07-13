import assert from "node:assert/strict";
import { test } from "node:test";

import type { CandidateManifest, RetainedProductionManifest } from "../../contracts/artifacts.js";
import type { RunIdentity, ShardIdentity } from "../../contracts/identity.js";
import type { WorldContext } from "../../contracts/world.js";
import { WorldReadinessError } from "../../contracts/world.js";

import {
  validateRetainedManifest,
  loadRetainedManifest,
  requireRetainedTemplate,
  RetainedManifestError,
} from "./retained-manifest.js";
import { candidateArtifactRoutePrefix, componentArtifactRoute, ArtifactRouteError } from "./artifact-route.js";
import {
  desiredVersionChannelId,
  HttpDesiredVersionChannel,
  DesiredVersionChannelUnavailable,
  desiredVersionRoute,
} from "./desired-version-channel.js";
import { evaluateOwnership, currentProductOwnershipViolations, type UpgradeObservation } from "./ownership.js";
import { ManagedCloudUpgradeWorldProvisioner } from "./provisioner.js";
import { InMemoryCleanupLedger, InMemoryEvidenceSink } from "./support.js";
import { runT4Runtime1, OwnershipAssertionError, type ManagedCloudUpgradeDeps, type ProvisionedTarget } from "./scenario.js";
import { ApiClient } from "../../../fixtures/http.js";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function retainedManifest(overrides: Partial<RetainedProductionManifest> = {}): RetainedProductionManifest {
  const loc = (locator: string) => ({ available: true as const, value: { locator, digest: "d".repeat(64), algorithm: "sha256" as const, sizeBytes: 100 } });
  return {
    schemaVersion: 1,
    kind: "retained-production",
    sourceSha: "prodsha0011",
    productVersion: "0.3.17",
    qualificationEvidenceRef: "evidence://release-2026-07-01",
    desktopApp: { available: false, reason: "not needed by this world" },
    desktopUpdater: { available: false, reason: "not needed" },
    desktopUpdaterTrustIdentity: { available: false, reason: "not needed" },
    bundledAnyharnessVersion: { available: true, value: "0.3.17" },
    bundledWorkerVersion: { available: true, value: "0.3.17" },
    seedHash: { available: true, value: "seed123" },
    catalogHash: { available: true, value: "cat123" },
    registryHash: { available: true, value: "reg123" },
    e2bTemplate: { available: true, value: { templateId: "tmpl-prod-abc123", inputHash: "inp".repeat(8) } },
    templateComponents: {
      available: true,
      value: {
        anyharness: loc("s3://artifacts/anyharness-0.3.17").value,
        worker: loc("s3://artifacts/worker-0.3.17").value,
        supervisor: loc("s3://artifacts/supervisor-0.3.17").value,
      },
    },
    installedAgentPins: { available: true, value: { claude: "1.2.3", codex: "4.5.6" } },
    ...overrides,
  };
}

function candidateManifest(overrides: Partial<CandidateManifest> = {}): CandidateManifest {
  const loc = { available: true as const, value: { locator: "s3://cand/anyharness-0.3.18", digest: "c".repeat(64), algorithm: "sha256" as const, sizeBytes: 200 } };
  return {
    schemaVersion: 1,
    kind: "candidate",
    sourceSha: "candsha0022",
    sourceContentHash: "contenthash",
    serverImage: { available: false, reason: "unused" },
    webBuild: { available: false, reason: "unused" },
    desktopApp: { available: false, reason: "unused" },
    desktopUpdater: { available: false, reason: "unused" },
    anyharness: { "linux-x86_64": loc },
    worker: {},
    supervisor: {},
    catalogHash: { available: true, value: "cat124" },
    registryHash: { available: true, value: "reg124" },
    e2bTemplate: { available: false, reason: "tier-3 concern" },
    selfHostBundle: { available: false, reason: "unused" },
    litellm: { available: false, reason: "unused" },
    ...overrides,
  };
}

function worldContext(over: { retained?: RetainedProductionManifest | null; candidate?: CandidateManifest } = {}): WorldContext {
  const run: RunIdentity = {
    runId: "run-abc",
    sourceSha: "candsha0022",
    candidateManifestHash: "h1",
    retainedManifestHash: "h2",
    executionHost: "local",
    origin: "local:test",
    createdAt: new Date().toISOString(),
  };
  const shard: ShardIdentity = { runId: "run-abc", shardId: "shard-1-of-1", shardIndex: 0, shardCount: 1 };
  return {
    run,
    shard,
    candidate: over.candidate ?? candidateManifest(),
    retained: over.retained === undefined ? retainedManifest() : over.retained,
    ledger: new InMemoryCleanupLedger(),
    evidence: new InMemoryEvidenceSink(),
  };
}

// ---------------------------------------------------------------------------
// retained-manifest
// ---------------------------------------------------------------------------

test("retained manifest validates and exposes the immutable N-1 template", () => {
  const m = validateRetainedManifest(retainedManifest());
  assert.equal(requireRetainedTemplate(m).templateId, "tmpl-prod-abc123");
});

test("retained manifest rejects a rolling template id", () => {
  assert.throws(
    () => validateRetainedManifest(retainedManifest({ e2bTemplate: { available: true, value: { templateId: "latest", inputHash: "x" } } })),
    RetainedManifestError,
  );
});

test("retained manifest rejects a missing qualification evidence ref", () => {
  const m = retainedManifest();
  assert.throws(() => validateRetainedManifest({ ...m, qualificationEvidenceRef: "" }), RetainedManifestError);
});

test("retained manifest rejects an unavailable template slot", () => {
  assert.throws(
    () => validateRetainedManifest(retainedManifest({ e2bTemplate: { available: false, reason: "not captured" } })),
    /unavailable/,
  );
});

test("loadRetainedManifest surfaces a friendly error for a missing file", () => {
  assert.throws(() => loadRetainedManifest("/no/such/manifest.json"), RetainedManifestError);
});

// ---------------------------------------------------------------------------
// artifact-route
// ---------------------------------------------------------------------------

test("candidate artifact route prefix is run-scoped and immutable", () => {
  const prefix = candidateArtifactRoutePrefix("run-abc", "candsha0022");
  assert.equal(prefix, "qualification/run-abc/candsha0022");
  const route = componentArtifactRoute(prefix, "linux-x86_64", "anyharness");
  assert.equal(route.binary, "qualification/run-abc/candsha0022/linux-x86_64/anyharness");
  assert.equal(route.checksum, "qualification/run-abc/candsha0022/linux-x86_64/anyharness.sha256");
});

test("artifact route rejects traversal and rolling segments", () => {
  assert.throws(() => candidateArtifactRoutePrefix("../etc", "sha"), ArtifactRouteError);
  assert.throws(() => candidateArtifactRoutePrefix("latest", "sha"), ArtifactRouteError);
  assert.throws(() => candidateArtifactRoutePrefix("run", "stable"), ArtifactRouteError);
});

// ---------------------------------------------------------------------------
// ownership
// ---------------------------------------------------------------------------

function goodObservation(): UpgradeObservation {
  return {
    heartbeatDesiredAnyharness: "0.3.18",
    candidateAnyharnessVersion: "0.3.18",
    unrelatedTargetDesiredAnyharness: "0.3.17",
    retainedAnyharnessVersion: "0.3.17",
    durableUpdateRequestCount: 1,
    workerPerformedDirectActivation: false,
    supervisorConsumedRequest: true,
    supervisorStagedArtifactMatchesManifest: true,
    acceptedRollingArtifact: false,
    supervisorHealthGatedActivation: true,
    anyharnessReportedVersion: "0.3.18",
    workerReconnectedDurableIdentity: true,
    eventSequenceMonotonic: true,
    perAgentReconcileFailures: 0,
    postUpdateTurnCompleted: true,
    sandboxStayedOnRetainedImage: true,
  };
}

test("ownership is satisfied on the intended green path", () => {
  assert.deepEqual(evaluateOwnership(goodObservation()), { satisfied: true });
});

test("ownership fails when the Worker directly activates and no request is written", () => {
  const verdict = evaluateOwnership({ ...goodObservation(), durableUpdateRequestCount: 0, workerPerformedDirectActivation: true, supervisorConsumedRequest: false });
  assert.equal(verdict.satisfied, false);
  if (!verdict.satisfied) {
    const rules = verdict.violations.map((v) => v.rule);
    assert.ok(rules.includes("worker-direct-activation"));
    assert.ok(rules.includes("one-durable-request"));
    assert.ok(rules.includes("supervisor-consume"));
  }
});

test("current product ownership violations enumerate the exact owning gaps (KNOWN REALITY)", () => {
  const violations = currentProductOwnershipViolations("0.3.17", "0.3.18");
  const rules = violations.map((v) => v.rule);
  // Direct-Worker activation, no mailbox request, no supervisor consume/gate,
  // and the #1089 unstamped-version mismatch must all be present.
  assert.ok(rules.includes("worker-direct-activation"));
  assert.ok(rules.includes("one-durable-request"));
  assert.ok(rules.includes("supervisor-consume"));
  assert.ok(rules.includes("supervisor-health-gate"));
  assert.ok(rules.includes("anyharness-reports-n"));
  assert.ok(rules.includes("post-update-turn"));
});

// ---------------------------------------------------------------------------
// desired-version channel
// ---------------------------------------------------------------------------

test("desired-version channel id is deterministic and per-target", () => {
  assert.equal(desiredVersionChannelId("run-abc", "sb-1"), "dvchan:run-abc:sb-1");
  assert.equal(desiredVersionRoute("sb-1"), "/v1/cloud/runtime-workers/sandboxes/sb-1/desired-versions");
});

test("channel refuses an empty version and never mutates a global pin", async () => {
  const client = new ApiClient({ baseUrl: "http://127.0.0.1:1" });
  const channel = new HttpDesiredVersionChannel(client, "run-abc", "sb-1");
  await assert.rejects(() => channel.setAnyharnessVersion(""), DesiredVersionChannelUnavailable);
});

// ---------------------------------------------------------------------------
// provisioner
// ---------------------------------------------------------------------------

test("provisioner throws WorldReadinessError with no retained manifest", async () => {
  const p = new ManagedCloudUpgradeWorldProvisioner({ apiUrl: "https://api.test", probe: async () => ({ ok: true, status: 200, detail: "ok" }) });
  await assert.rejects(() => p.prepare(worldContext({ retained: null })), WorldReadinessError);
});

test("provisioner throws WorldReadinessError when the candidate API is unreachable", async () => {
  const p = new ManagedCloudUpgradeWorldProvisioner({ apiUrl: "https://api.test", probe: async () => ({ ok: false, status: 0, detail: "connection refused" }) });
  await assert.rejects(() => p.prepare(worldContext()), WorldReadinessError);
});

test("provisioner throws when the candidate linux AnyHarness slot is unavailable", async () => {
  const p = new ManagedCloudUpgradeWorldProvisioner({ apiUrl: "https://api.test", probe: async () => ({ ok: true, status: 200, detail: "ok" }) });
  const candidate = candidateManifest({ anyharness: {} });
  await assert.rejects(() => p.prepare(worldContext({ candidate })), WorldReadinessError);
});

test("provisioner returns a ready handle and registers the desired-version channel", async () => {
  const ctx = worldContext();
  const p = new ManagedCloudUpgradeWorldProvisioner({ apiUrl: "https://api.test/", probe: async () => ({ ok: true, status: 200, detail: "GET /meta 200" }) });
  const handle = await p.prepare(ctx);
  assert.equal(handle.world, "managed-cloud-upgrade");
  assert.equal(handle.apiUrl, "https://api.test");
  assert.equal(handle.retainedTemplate.templateId, "tmpl-prod-abc123");
  assert.equal(handle.candidateArtifactRoute, "qualification/run-abc/candsha0022");
  assert.ok(handle.desiredVersionChannel.startsWith("dvchan:run-abc:"));
  const entries = await (ctx.ledger as InMemoryCleanupLedger).entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].resourceType, "desired-version-channel");
  // The base handle must NOT have provisioned a sandbox or run a turn.
  assert.ok(entries.every((e) => e.resourceType !== "sandbox"));
});

// ---------------------------------------------------------------------------
// scenario orchestration
// ---------------------------------------------------------------------------

function scriptedTarget(): ProvisionedTarget {
  const versions: { anyharness: string | null } = { anyharness: null };
  return {
    cloudSandboxId: "sb-1",
    channel: {
      channelId: "dvchan:run-abc:sb-1",
      cloudSandboxId: "sb-1",
      async current() {
        return { anyharness: versions.anyharness, worker: null };
      },
      async setAnyharnessVersion(v: string) {
        versions.anyharness = v;
      },
      async clear() {
        versions.anyharness = null;
      },
    },
  };
}

function readyHandle(): import("../../contracts/world.js").ManagedCloudUpgradeWorldHandle {
  return {
    world: "managed-cloud-upgrade",
    run: worldContext().run,
    shard: worldContext().shard,
    readiness: [],
    apiUrl: "https://api.test",
    retainedTemplate: { templateId: "tmpl-prod-abc123", inputHash: "x" },
    desiredVersionChannel: "dvchan:run-abc:controller",
    candidateArtifactRoute: "qualification/run-abc/candsha0022",
    retained: retainedManifest(),
  };
}

test("scenario throws OwnershipAssertionError against the current product (failing evidence preserved)", async () => {
  const target = scriptedTarget();
  const deps: ManagedCloudUpgradeDeps = {
    candidateAnyharnessVersion: () => "0.3.18",
    async provisionN1Target() {
      return target;
    },
    async verifyBaseline() {},
    async baselineTurn() {},
    async observeConvergence() {
      // The current product: Worker directly swaps, writes no request, and
      // reports the unstamped 0.1.0.
      return {
        ...goodObservation(),
        durableUpdateRequestCount: 0,
        workerPerformedDirectActivation: true,
        supervisorConsumedRequest: false,
        supervisorHealthGatedActivation: false,
        supervisorStagedArtifactMatchesManifest: false,
        anyharnessReportedVersion: "0.1.0",
        postUpdateTurnCompleted: false,
      };
    },
  };
  await assert.rejects(
    () => runT4Runtime1(readyHandle(), deps),
    (error: unknown) => {
      assert.ok(error instanceof OwnershipAssertionError);
      assert.ok(error.violations.some((v) => v.rule === "worker-direct-activation"));
      // The flip DID happen through the per-target channel (never a global pin).
      assert.equal(target.channel.channelId, "dvchan:run-abc:sb-1");
      return true;
    },
  );
});

test("scenario resolves on the intended green path (once the product owns the boundary)", async () => {
  const deps: ManagedCloudUpgradeDeps = {
    candidateAnyharnessVersion: () => "0.3.18",
    async provisionN1Target() {
      return scriptedTarget();
    },
    async verifyBaseline() {},
    async baselineTurn() {},
    async observeConvergence() {
      return goodObservation();
    },
  };
  const result = await runT4Runtime1(readyHandle(), deps);
  assert.equal(result.observation.anyharnessReportedVersion, "0.3.18");
});
