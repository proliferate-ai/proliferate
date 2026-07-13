import assert from "node:assert/strict";
import { test } from "node:test";

import type { ManagedCloudWorldHandle } from "../../contracts/world.js";
import {
  CloudProvision1FailedError,
  CloudProvisionBlockedError,
  runCloudProvision1,
  type CloudProvisionActor,
  type CloudProvisionDriver,
} from "./cloud-provision-1.js";
import { memLedger, recordingEvidenceSink } from "./test-support.js";

const IMMUTABLE = "sha-abc123def456";

function handle(overrides: Partial<ManagedCloudWorldHandle> = {}): ManagedCloudWorldHandle {
  return {
    world: "managed-cloud",
    run: {
      runId: "run-1",
      sourceSha: "0".repeat(40),
      candidateManifestHash: "h",
      retainedManifestHash: null,
      executionHost: "local",
      origin: "local:test",
      createdAt: new Date().toISOString(),
    },
    shard: { runId: "run-1", shardId: "shard-1-of-1", shardIndex: 0, shardCount: 1 },
    readiness: [],
    apiUrl: "https://candidate.example/api",
    template: { templateId: IMMUTABLE, inputHash: "h1" },
    gatewayOrigin: "https://gw.example",
    verifiedCapabilities: ["candidate-api", "e2b-template", "github-app", "e2b", "litellm"],
    ...overrides,
  };
}

function actor(): CloudProvisionActor {
  return { email: "a@x.dev", userId: "user-A", teardown: async () => {} };
}

/** A driver whose every step is happy and whose sandbox is bound to the immutable template. */
function happyDriver(overrides: Partial<CloudProvisionDriver> = {}): { driver: CloudProvisionDriver; teardowns: string[] } {
  const teardowns: string[] = [];
  const a = actor();
  const sandbox = { id: "sb-1", ownerUserId: "user-A", status: "ready", e2bTemplateRef: IMMUTABLE };
  let tailCalls = 0;
  const driver: CloudProvisionDriver = {
    mintActor: async () => a,
    attemptGatedRepoAction: async () => ({ gated: true, code: "github_app_authorization_required" }),
    runAuthorizationTail: async () => {
      tailCalls += 1;
      return { preExistingSandbox: tailCalls > 1, sandboxKickedOffByTrigger: tailCalls === 1, authorizationReady: true };
    },
    readPersonalSandbox: async () => sandbox,
    probeRuntimeReadiness: async () => ({ anyharnessReady: true, agentCount: 3, workerEnrolled: true, supervisorActiveParent: true, detail: "ok" }),
    materializeRepository: async () => ({ cloned: true, defaultBranch: "main", remoteUrlSecretFree: true, detail: "cloned" }),
    runCheapTurn: async () => ({ completed: true, assistantReplyNonEmpty: true, errorEvent: null, detail: "turn ok" }),
    teardownSandbox: async () => { teardowns.push("sandbox"); },
    ...overrides,
  };
  return { driver, teardowns };
}

test("happy path: every required step green and cleanup complete", async () => {
  const { ledger } = memLedger();
  const { sink } = recordingEvidenceSink();
  const { driver, teardowns } = happyDriver();
  const report = await runCloudProvision1({ handle: handle(), driver, ledger, evidence: sink, repository: "o/r" });
  assert.equal(report.green, true);
  assert.equal(report.cleanupComplete, true);
  assert.ok(report.steps.every((s) => s.ok));
  // Sandbox torn down (cleanup ran in reverse order).
  assert.deepEqual(teardowns, ["sandbox"]);
});

test("blocked when the world handle lacks GitHub App authority", async () => {
  const { ledger } = memLedger();
  const { sink } = recordingEvidenceSink();
  const { driver } = happyDriver();
  await assert.rejects(
    runCloudProvision1({ handle: handle({ verifiedCapabilities: ["candidate-api"] }), driver, ledger, evidence: sink, repository: "o/r" }),
    CloudProvisionBlockedError,
  );
});

test("red when the sandbox is bound to a rolling template ref (product gap)", async () => {
  const { ledger } = memLedger();
  const { sink } = recordingEvidenceSink();
  const { driver } = happyDriver({
    readPersonalSandbox: async () => ({ id: "sb-1", ownerUserId: "user-A", status: "ready", e2bTemplateRef: "v1" }),
  });
  await assert.rejects(
    runCloudProvision1({ handle: handle(), driver, ledger, evidence: sink, repository: "o/r" }),
    (err: Error) => {
      assert.ok(err instanceof CloudProvision1FailedError);
      const step = err.report.steps.find((s) => s.step === "candidate-template-identity");
      assert.equal(step?.ok, false);
      assert.ok(step?.detail.includes("ROLLING"));
      // Cleanup still ran despite the red assertion.
      assert.equal(err.report.cleanupComplete, true);
      return true;
    },
  );
});

test("red when a replayed callback produces a second/distinct sandbox", async () => {
  const { ledger } = memLedger();
  const { sink } = recordingEvidenceSink();
  let call = 0;
  const { driver } = happyDriver({
    readPersonalSandbox: async () => {
      call += 1;
      return { id: call === 1 ? "sb-1" : "sb-2", ownerUserId: "user-A", status: "ready", e2bTemplateRef: IMMUTABLE };
    },
  });
  await assert.rejects(runCloudProvision1({ handle: handle(), driver, ledger, evidence: sink, repository: "o/r" }), (err: Error) => {
    assert.ok(err instanceof CloudProvision1FailedError);
    const step = err.report.steps.find((s) => s.step === "exactly-one-sandbox");
    assert.equal(step?.ok, false);
    assert.ok(/exactly one/i.test(step?.detail ?? ""));
    return true;
  });
});

test("red when Supervisor is not the active parent — assertion not weakened", async () => {
  const { ledger } = memLedger();
  const { sink } = recordingEvidenceSink();
  const { driver } = happyDriver({
    probeRuntimeReadiness: async () => ({ anyharnessReady: true, agentCount: 2, workerEnrolled: true, supervisorActiveParent: false, detail: "worker is the active parent" }),
  });
  await assert.rejects(runCloudProvision1({ handle: handle(), driver, ledger, evidence: sink, repository: "o/r" }), (err: Error) => {
    assert.ok(err instanceof CloudProvision1FailedError);
    const step = err.report.steps.find((s) => s.step === "worker-supervisor-anyharness-readiness");
    assert.equal(step?.ok, false);
    return true;
  });
});

test("cleanup runs and resources are torn down even when a step throws mid-slice", async () => {
  const { ledger, rows } = memLedger();
  const { sink } = recordingEvidenceSink();
  const teardowns: string[] = [];
  const a = actor();
  const driver = happyDriver().driver;
  driver.mintActor = async () => ({ ...a, teardown: async () => { teardowns.push("membership"); } });
  driver.teardownSandbox = async () => { teardowns.push("sandbox"); };
  driver.runAuthorizationTail = async () => { throw new Error("provisioning exploded"); };

  await assert.rejects(runCloudProvision1({ handle: handle(), driver, ledger, evidence: sink, repository: "o/r" }));
  // Both resources were ledgered before the throw and cleaned in reverse order.
  assert.deepEqual(teardowns, ["sandbox", "membership"]);
  assert.ok(rows.every((r) => r.state === "cleaned" || r.state === "absent"));
});

test("redaction: no secret value reaches evidence or step detail", async () => {
  const { ledger } = memLedger();
  const { sink, events } = recordingEvidenceSink();
  const { driver } = happyDriver({
    materializeRepository: async () => ({ cloned: true, defaultBranch: "main", remoteUrlSecretFree: true, detail: "cloned https://x-access-token:ghs_LEAKED@github.com/o/r.git" }),
  });
  const report = await runCloudProvision1({
    handle: handle(),
    driver,
    ledger,
    evidence: sink,
    repository: "o/r",
    secretValues: ["ghs_LEAKED"],
  });
  const serialized = JSON.stringify(events) + JSON.stringify(report);
  assert.ok(!serialized.includes("ghs_LEAKED"));
});
