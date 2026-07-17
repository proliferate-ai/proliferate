import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIXTURE_SMOKE_CELL_NAMES,
  MANAGED_CLOUD_FIXTURE_SMOKE_1_ID,
  assertDuplicateDeliveryByteIdentity,
  managedCloudFixtureSmoke1,
  resolveSmokeSecretKey,
  runFixtureSmokeCells,
  type FixtureSmokeCellResult,
  type FixtureSmokeDriver,
  type StripePreparation,
} from "./managed-cloud-fixture-smoke-1.js";
import { isMatrixScenario, type ScenarioRunContext } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { EnvResolution } from "../config/env-resolution.js";
import type { CapturedDelivery } from "../fixtures/callback-relay.js";
import type { PlannedCellV1 } from "../runner/result.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";
import type { ManagedCloudCleanupEvidence } from "../worlds/managed-cloud/cleanup-kinds.js";

const REQUIRED_ENV_VARS: Record<string, string> = {
  AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.litellm.example",
  AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://public.litellm.example",
  AGENT_GATEWAY_LITELLM_MASTER_KEY: "sk-test-master",
  RELEASE_E2E_E2B_API_KEY: "e2b-test-key",
  RELEASE_E2E_E2B_TEAM_ID: "team-test",
  RELEASE_E2E_CLOUD_AWS_REGION: "us-east-1",
  RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID: "Z000000TEST",
  RELEASE_E2E_CLOUD_GITHUB_APP_ID: "123456",
  RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID: "Iv1.testclientid",
  RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID: "78901",
  RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
  RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET: "test-client-secret",
  STRIPE_TEST_SECRET_KEY: "sk_test_abc123",
};

function fakeCandidateMap(): CandidateBuildMapV1 {
  return { schema_version: 1, kind: "proliferate.candidate-build", source_sha: "a".repeat(40), artifacts: [] };
}

function fakeEnv(overrides: Record<string, string | undefined> = {}): EnvResolution {
  const values: Record<string, string> = { ...REQUIRED_ENV_VARS };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete values[key];
    } else {
      values[key] = value;
    }
  }
  return {
    all: [],
    missing: [],
    present: (name) => values[name] !== undefined,
    get: (name) => values[name],
    require: (name) => {
      const value = values[name];
      if (!value) {
        throw new Error(`missing required env var "${name}"`);
      }
      return value;
    },
  };
}

function fakeCtx(overrides: Partial<ScenarioRunContext> = {}): ScenarioRunContext {
  return {
    targetLane: "cloud",
    runtimeLane: "sandbox",
    desktop: "web",
    agents: ["claude"],
    dryRun: false,
    env: fakeEnv(),
    candidateBuildMap: fakeCandidateMap(),
    runIdentity: {
      run_id: "smoke-run-1",
      shard_id: "smoke-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    runDir: "/tmp/smoke-run-1",
    ports: null,
    ...overrides,
  };
}

function fakeArtifact(id: string) {
  return { artifact_id: id, version: "1.0.0", sha256: "a".repeat(64), path: `/tmp/${id.replace(/\//g, "-")}` };
}

function fakeWorld(closeImpl?: () => Promise<ManagedCloudCleanupEvidence>): ManagedCloudWorld & { closeCalls: number } {
  const calls = { closeCalls: 0 };
  const world = {
    kind: "managed-cloud",
    run: fakeCtx().runIdentity!,
    artifacts: {
      server: fakeArtifact("server/linux/amd64"),
      anyharness: fakeArtifact("anyharness/x86_64-unknown-linux-musl"),
      worker: fakeArtifact("worker/x86_64-unknown-linux-musl"),
      supervisor: fakeArtifact("supervisor/x86_64-unknown-linux-musl"),
      credentialHelper: fakeArtifact("credential-helper/x86_64-unknown-linux-musl"),
      desktopRenderer: fakeArtifact("desktop-renderer/browser"),
      template: {
        artifact_id: "e2b-template/smoke-run-1",
        templateId: "tmpl_123",
        buildId: "build_456",
        inputHash: "b".repeat(64),
        bakedInputs: [],
      },
      candidateApi: {
        artifact_id: "candidate-api/smoke-run-1.qualification.proliferate.com",
        version: "1.0.0",
        sha256: "c".repeat(64),
        publicOrigin: "https://smoke-run-1.qualification.proliferate.com",
        ec2InstanceId: "i-0123456789",
      },
    },
    api: { baseUrl: "https://smoke-run-1.qualification.proliferate.com", client: {} as never },
    renderer: { baseUrl: "https://smoke-run-1.qualification.proliferate.com", browser: {} as never },
    gateway: {} as never,
    sandbox: { e2bTeamId: "team-test" },
    paths: { runDir: "/tmp/smoke-run-1", secretsDir: "/tmp/smoke-run-1/secrets" },
    registerCleanup: async () => undefined,
    registerCleanupIntent: async () => ({ entryId: "e", markAcquired: async () => undefined }),
    trackActorSubjects: async () => undefined,
    close:
      closeImpl ??
      (async (): Promise<ManagedCloudCleanupEvidence> => {
        calls.closeCalls += 1;
        return cleanEvidence();
      }),
  } as unknown as ManagedCloudWorld & { closeCalls: number };
  Object.defineProperty(world, "closeCalls", { get: () => calls.closeCalls });
  return world;
}

function cleanEvidence(): ManagedCloudCleanupEvidence {
  return {
    ledgerIdHash: "e".repeat(64),
    registered: 5,
    reconciled: 5,
    failed: 0,
    sandboxesDeleted: true,
    templateDeleted: true,
    dnsRecordDeleted: true,
    ec2Terminated: true,
    securityGroupDeleted: true,
    keyPairDeleted: true,
    virtualKeyDeleted: true,
    litellmSubjectsDeleted: true,
    localPathsRemoved: true,
    billingFixtureCleared: true,
    relayStopped: true,
    stripeFixturesDeleted: true,
  };
}

function fakePrep(): StripePreparation {
  return {
    secretsEnvFilePath: "/tmp/smoke-run-1/secrets/stripe.env",
    webhookSecretEnvFilePath: "/tmp/smoke-run-1/secrets/stripe-webhook.env",
    subdomain: "mcq-smoke-run-1-smoke-0.qualification.proliferate.com",
    webhookEndpointId: "we_123",
    webhookIntentRef: "intent:webhook_endpoint:url=https://x/v1/billing/webhooks/stripe",
  };
}

function cellResult(transition: string): FixtureSmokeCellResult {
  return { externalIds: ["cus_1"], observedTransition: transition, cleanupEntries: ["stripe_customer"] };
}

function cleanupReplayResult(): FixtureSmokeCellResult {
  return {
    externalIds: ["cus_e"],
    observedTransition: "swept_zero",
    cleanupEntries: ["stripe_customer"],
    providerSweeps: [
      { provider: "aws", remaining_owned_resources: 0 },
      { provider: "stripe", remaining_owned_resources: 0 },
      { provider: "e2b", remaining_owned_resources: 0 },
      { provider: "process", remaining_owned_resources: 0 },
      { provider: "filesystem", remaining_owned_resources: 0 },
    ],
  };
}

/** A fully-wired happy-path fake driver; tests override methods. */
function fakeDriver(
  overrides: Partial<FixtureSmokeDriver> = {},
): FixtureSmokeDriver & { world: ManagedCloudWorld & { closeCalls: number }; closeWorldCalls: number } {
  const world = fakeWorld();
  const state = { closeWorldCalls: 0 };
  const driver: FixtureSmokeDriver & { world: typeof world; closeWorldCalls: number } = {
    world,
    get closeWorldCalls() {
      return state.closeWorldCalls;
    },
    prepareStripe: async () => fakePrep(),
    buildWorld: async () => world,
    adoptWebhookIntent: async () => undefined,
    runCallbackRelayCell: async () => cellResult("held→replayed→duplicate:byte_identical(abc)"),
    runStripeTestClockCell: async () => cellResult("created→advanced→event_observed→recovered_by_identity→deleted_absent"),
    runBillingThresholdCell: async () => cellResult("positioned:remaining=0.001"),
    runFailureInjectionCell: async () => cellResult("control_ok→injected_failure(500)→recovered→control_ok(relay=true)"),
    runCleanupReplayCell: async (_w, _s, closeWorld) => {
      await closeWorld();
      return cleanupReplayResult();
    },
    closeWorld: async () => {
      state.closeWorldCalls += 1;
    },
    ...overrides,
  };
  return driver;
}

function cellsFor(names: readonly string[]): PlannedCellV1[] {
  return names.map((name) => ({
    cell_id: `${MANAGED_CLOUD_FIXTURE_SMOKE_1_ID}/sandbox/cell=${name}`,
    scenario_id: MANAGED_CLOUD_FIXTURE_SMOKE_1_ID,
    registry_flow_ref: "specs/developing/testing/flows.md#cloud-provision",
    runtime_lane: "sandbox",
    dimensions: { cell: name },
    required_env: [],
  }));
}

const ALL_CELLS = cellsFor(FIXTURE_SMOKE_CELL_NAMES);

test("the scenario is a matrix over exactly the five fixture cells", async () => {
  assert.ok(isMatrixScenario(managedCloudFixtureSmoke1));
  if (isMatrixScenario(managedCloudFixtureSmoke1)) {
    const cells = await managedCloudFixtureSmoke1.expandCells({ runtimeLane: "sandbox", desktop: "web", agents: ["claude"] });
    assert.deepEqual(
      cells.map((c) => c.dimensions.cell).sort(),
      [...FIXTURE_SMOKE_CELL_NAMES].sort(),
    );
  }
  assert.ok(managedCloudFixtureSmoke1.requiredEnv.includes("STRIPE_TEST_SECRET_KEY"));
});

test("all five cells go green with kind-scoped evidence on the happy path", async () => {
  const driver = fakeDriver();
  const outcomes = await runFixtureSmokeCells(fakeCtx(), ALL_CELLS, driver);
  assert.equal(outcomes.length, 5);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "green", `${outcome.cellId} should be green`);
    const evidence = (outcome as { evidence?: { kind?: string; cells?: unknown[] } }).evidence;
    assert.equal(evidence?.kind, "managed_cloud_fixture_smoke");
    assert.equal(evidence?.cells?.length, 1, "each cell carries exactly its own entry");
  }
  // The world is closed exactly once (by cleanup-replay).
  assert.equal(driver.closeWorldCalls, 1);
});

test("a failing earlier cell does not poison later cells (independent judgment)", async () => {
  const driver = fakeDriver({
    runCallbackRelayCell: async () => {
      throw new Error("relay boom");
    },
  });
  const outcomes = await runFixtureSmokeCells(fakeCtx(), ALL_CELLS, driver);
  const byCell = new Map(outcomes.map((o) => [o.cellId, o]));
  assert.equal(byCell.get(`${MANAGED_CLOUD_FIXTURE_SMOKE_1_ID}/sandbox/cell=callback-relay`)?.status, "failed");
  assert.equal(byCell.get(`${MANAGED_CLOUD_FIXTURE_SMOKE_1_ID}/sandbox/cell=stripe-test-clock`)?.status, "green");
  assert.equal(byCell.get(`${MANAGED_CLOUD_FIXTURE_SMOKE_1_ID}/sandbox/cell=cleanup-replay`)?.status, "green");
  assert.equal(driver.closeWorldCalls, 1);
});

test("cleanup-replay runs last and the world is closed exactly once even when it is the only assigned cell", async () => {
  const driver = fakeDriver();
  const outcomes = await runFixtureSmokeCells(fakeCtx(), cellsFor(["cleanup-replay"]), driver);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.status, "green");
  assert.equal(driver.closeWorldCalls, 1);
});

test("the world is still closed when cleanup-replay is NOT assigned (no leak, no cleanup outcome)", async () => {
  const driver = fakeDriver();
  const outcomes = await runFixtureSmokeCells(fakeCtx(), cellsFor(["callback-relay"]), driver);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.status, "green");
  // The finally-close ran even though cleanup-replay did not emit an outcome.
  assert.equal(driver.closeWorldCalls, 1);
});

test("missing STRIPE_TEST_SECRET_KEY fails every assigned cell with a bounded reason and no side effects", async () => {
  let buildWorldCalled = false;
  const driver = fakeDriver({
    buildWorld: async () => {
      buildWorldCalled = true;
      return fakeWorld();
    },
  });
  const outcomes = await runFixtureSmokeCells(
    fakeCtx({ env: fakeEnv({ STRIPE_TEST_SECRET_KEY: undefined }) }),
    ALL_CELLS,
    driver,
  );
  assert.equal(outcomes.length, 5);
  assert.ok(outcomes.every((o) => o.status === "failed"));
  assert.match(outcomes[0]!.reason?.message ?? "", /STRIPE_TEST_SECRET_KEY is not set/);
  assert.equal(buildWorldCalled, false);
  assert.equal(driver.closeWorldCalls, 0);
});

test("a live-mode STRIPE_TEST_SECRET_KEY fails closed before any world side effect", async () => {
  let prepareCalled = false;
  const driver = fakeDriver({
    prepareStripe: async () => {
      prepareCalled = true;
      return fakePrep();
    },
  });
  const outcomes = await runFixtureSmokeCells(
    fakeCtx({ env: fakeEnv({ STRIPE_TEST_SECRET_KEY: "sk_live_dangerous" }) }),
    ALL_CELLS,
    driver,
  );
  assert.ok(outcomes.every((o) => o.status === "failed"));
  assert.match(outcomes[0]!.reason?.message ?? "", /LIVE-mode/);
  assert.equal(prepareCalled, false);
});

test("resolveSmokeSecretKey rejects missing and live keys, accepts a test key", () => {
  assert.equal(resolveSmokeSecretKey(fakeCtx()).ok, true);
  assert.equal(resolveSmokeSecretKey(fakeCtx({ env: fakeEnv({ STRIPE_TEST_SECRET_KEY: undefined }) })).ok, false);
  assert.equal(resolveSmokeSecretKey(fakeCtx({ env: fakeEnv({ STRIPE_TEST_SECRET_KEY: "rk_live_x" }) })).ok, false);
});

test("world construction failure fails every assigned cell cleanly", async () => {
  const driver = fakeDriver({
    buildWorld: async () => {
      throw new Error("aws quota exceeded");
    },
  });
  const outcomes = await runFixtureSmokeCells(fakeCtx(), ALL_CELLS, driver);
  assert.ok(outcomes.every((o) => o.status === "failed"));
  assert.match(outcomes[0]!.reason?.message ?? "", /world construction failed/);
});

// ── Duplicate-delivery byte-identity witness (pure) ─────────────────────────

function delivery(overrides: Partial<CapturedDelivery>): CapturedDelivery {
  return {
    deliveryId: "d1",
    channel: "stripe",
    providerEventId: "evt_1",
    bytesSha256: "s".repeat(64),
    receivedAt: new Date().toISOString(),
    state: "held",
    ...overrides,
  };
}

test("assertDuplicateDeliveryByteIdentity witnesses a new byte-identical forwarded row", () => {
  const before = [delivery({ deliveryId: "d1", state: "replayed:200" })];
  const after = [
    delivery({ deliveryId: "d1", state: "replayed:200" }),
    delivery({ deliveryId: "d1", state: "replayed:200" }),
  ];
  const witness = assertDuplicateDeliveryByteIdentity(before, after, "evt_1");
  assert.equal(witness.bytesSha256, "s".repeat(64));
});

test("assertDuplicateDeliveryByteIdentity throws when the duplicate's bytes differ", () => {
  const before = [delivery({ bytesSha256: "s".repeat(64) })];
  const after = [
    delivery({ bytesSha256: "s".repeat(64) }),
    delivery({ bytesSha256: "d".repeat(64) }),
  ];
  assert.throws(() => assertDuplicateDeliveryByteIdentity(before, after, "evt_1"), /did not forward verbatim/);
});

test("assertDuplicateDeliveryByteIdentity throws when no new forwarded row appeared", () => {
  const before = [delivery({})];
  assert.throws(() => assertDuplicateDeliveryByteIdentity(before, before, "evt_1"), /no NEW forwarded row/);
});

test("assertDuplicateDeliveryByteIdentity throws when there is no baseline row for the event", () => {
  assert.throws(() => assertDuplicateDeliveryByteIdentity([], [], "evt_missing"), /no baseline delivery row/);
});
